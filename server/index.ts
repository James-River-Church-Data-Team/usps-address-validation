import express from "express";
import val from "express-validator";
import { backOff } from "exponential-backoff";
import LRUMap_module from "lru_map";
import { retryPolicy, ShouldRetry } from "./common.js";
import { TokenHolder } from "./token-holder.js";
import {
	ALLOW_ORIGIN, ALLOWED_IPS, CACHE_COUNT, ENABLE_METRICS, PORT
} from "./env.js";

const { LRUMap } = LRUMap_module;

interface USPSResBody {
	address: {
		streetAddress: string;
		city: string;
		state: string;
		ZIPCode: string;
		ZIPPlus4: string;
	};
	corrections: {
		code: string;
		text: string;
	}[];
	matches: {
		code: string;
		text: string;
	}[];
}

const MINUTE = 60 * 1_000;


function validateUspsResponse(uspsBody: unknown): uspsBody is USPSResBody {
	return typeof uspsBody === "object"
		&& uspsBody !== null
		&& (
			(
				"address" in uspsBody
				&& "corrections" in uspsBody
				&& "matches" in uspsBody
			) || (
				"error" in uspsBody
				&& typeof uspsBody.error === "object"
				&& uspsBody.error !== null
				&& "code" in uspsBody.error
				&& "message" in uspsBody.error
				&& "errors" in uspsBody.error
			)
		);
}


const app = express();
const cache = new LRUMap<string, USPSResBody>(CACHE_COUNT);
const tokenHolder = new TokenHolder();

const uspsHits: Date[] = [];


app.get("/",
	// Firewall
	(req, _, next) => {
		console.log(`Request from ${req.socket.remoteAddress}`);
		if (
			req.socket.remoteAddress === undefined
			|| (
				ALLOWED_IPS.length > 0
				&& !ALLOWED_IPS.includes(req.socket.remoteAddress)
			)
		) {
			console.log(" ** Rejected");
			return;
		}
		next();
	},

	// Logging that needs to be done even on invalid queries
	(req, _, next) => {
		if (req.query === undefined || Object.keys(req.query).length > 0) {
			console.log(" ** Query:");
			console.log(req.query);
		} else {
			console.log(" ** Query: [empty]");
		}
		next();
	},

	// Set CORS headers
	(_, res, next) => {
		res.header("Access-Control-Allow-Origin", ALLOW_ORIGIN);
		res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		// I *believe* we just need the default allowlist
		// res.header("Access-Control-Allow-Headers", "*");
		next();
	},

	// Validate query params
	val.query("streetAddress").notEmpty().isString(),
	val.query("city").notEmpty().isString(),
	val.query("state").notEmpty().isString(),
	(req, res, next) => {
		const err = val.validationResult(req);
		if (!err.isEmpty()) {
			console.log(" ** Invalid query");
			res.status(400).json(err.mapped());
			return;
		}
		next();
	},

	async (req, res) => {
		// Serialize query for our own purposes
		const queryString = new URLSearchParams(req.query).toString();

		// Short-circuit from cache
		const cachedResponse = cache.get(queryString);
		if (cachedResponse !== undefined) {
			console.log(" ** Cache hit:");
			console.debug(cachedResponse);
			res.json(cachedResponse);
			console.log(" ** ✔ Resent cached response");
			return;
		}
		console.log(" ** Cache miss; requesting from USPS");

		// Forward the request to USPS
		const uspsRes = await backOff(async () => {
			const token = await tokenHolder.fetch(req);
			const response = await fetch(
				`https://apis.usps.com/addresses/v3/address?${queryString}`, {
					headers: {
						"Authorization": `Bearer ${token.data}`,
						"Accept": "application/json",
					},
				},
			);
			if (response.status === 401) {  // Unauthorized
				console.warn(" ** USPS: Received Unauthorized");
				tokenHolder.invalidate(token.id);
				throw new ShouldRetry();
			}
			return response;
		}, { retry: retryPolicy(req) });

		// Parse the response from USPS
		const uspsBody = await uspsRes.json();
		console.debug(uspsBody);

		// Make sure the USPS response looks as we expect
		if (!validateUspsResponse(uspsBody)) {
			console.error(" ** Unrecognized response from USPS");
			res.sendStatus(502);  // Bad Gateway
			return;
		}

		// Cache the USPS response if 2xx or 400
		if (
			uspsRes.status >= 200 && uspsRes.status < 300
			// If an address is invalid, it's not going to become valid in
			// two hours
			|| uspsRes.status === 400
		) {
			cache.set(queryString, uspsBody);
			console.log(" ** Stored to cache");
		} else {
			console.log(" ** Response was not 2xx or 400; not caching");
		}

		// Respond back to the user with USPS's response
		res.json(uspsBody);
		console.log(" ** ✔ Sent response");

		// Metrics logging
		const now = new Date();
		uspsHits.push(now);
		// Remove hits older than one hour
		while (
			uspsHits.length > 0
			&& now.getTime() - uspsHits[0].getTime() > MINUTE * 60
		) {
			uspsHits.shift();
		}
	},
);


if (ENABLE_METRICS) {
	setInterval(() => {
		console.log(`USPS requests per hour: ${uspsHits.length}`);
	}, MINUTE * 15);
}


app.listen(PORT, "0.0.0.0", () => console.log(`Listening on port ${PORT}`));
