import express from "express";
import val from "express-validator";
import { backOff } from "exponential-backoff";
import LRUMap_pkg from "lru_map";
import { ShouldRetry } from "./common.js";
import { TokenHolder } from "./token-holder.js";

const { LRUMap } = LRUMap_pkg;


const port = process.env.PORT !== undefined
	? parseInt(process.env.PORT)
	: 10_000;

// 50,000: I expect response bodies to be ~1kb each, so this should take about
// up to 50MB of RAM.
const CACHE_COUNT = process.env.CACHE_COUNT !== undefined
	? parseInt(process.env.CACHE_COUNT)
	: 50_000;

const errors: Error[] = [];
const ALLOWED_IPS: string[] = (() => {
	if (process.env.ALLOWED_IPS === undefined) return [];
	let arr: unknown;
	try {
		arr = JSON.parse(process.env.ALLOWED_IPS);
	} catch (err) {
		if (err instanceof Error) {
			errors.push(err);
		} else if (typeof err === "string") {
			errors.push(new Error(err));
		} else {
			errors.push(
				new Error(
					"Env var ALLOWED_IPS: JSON.parse() catastrophic failure"
				)
			);
		}
		return [];
	}
	if (!(arr instanceof Array)) {
		errors.push(new Error(
			"Env var ALLOWED_IPS must be a JSON array of strings")
		);
		return [];
	}
	for (let i = 0; i < arr.length; i++) {
		if (typeof arr[i] !== "string") {
			errors.push(
				new Error(
					`Env var ALLOWED_IPS: entry at index ${i} is not a string`
				)
			);
		}
	}
	return arr;
})();
if (process.env.USPS_CLIENT_ID === undefined) {
	errors.push(new Error("Missing env var USPS_CLIENT_ID"));
}
if (process.env.USPS_CLIENT_SECRET === undefined) {
	errors.push(new Error("Missing env var USPS_CLIENT_SECRET"));
}
if (process.env.ALLOW_ORIGIN === undefined) {
	errors.push(new Error("Missing env var ALLOW_ORIGIN"));
}
if (errors.length > 0) {
	const up = new AggregateError(errors);
	for (const err of errors) console.error(err);
	throw up;
}


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


function validateUspsResponse(uspsBody: unknown): uspsBody is USPSResBody {
	return typeof uspsBody === "object"
		&& uspsBody !== null
		&& "address" in uspsBody
		&& "corrections" in uspsBody
		&& "matches" in uspsBody;
}


const app = express();
const cache = new LRUMap<string, USPSResBody>(CACHE_COUNT);
const tokenHolder = new TokenHolder();


app.get("/",
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

	// Validate query params
	val.query("streetAddress").notEmpty().isString(),
	val.query("city")         .notEmpty().isString(),
	val.query("state")        .notEmpty().isString(),
	val.query("ZIPCode")      .notEmpty().isNumeric({ no_symbols: true }),
	val.query("ZIPPlu4")      .notEmpty().isNumeric({ no_symbols: true }),
	(req, res, next) => {
		const err = val.validationResult(req);
		if (!err.isEmpty()) return res.status(400).json(err.mapped());
		next();
	},

	async (req, res) => {
		console.log(` ** Query: ${req.query}`);

		// Serialize query for our own purposes
		const queryString = new URLSearchParams(req.query).toString();

		// Short-circuit from cache
		const cachedResponse = cache.get(queryString);
		if (cachedResponse !== undefined) {
			console.log(" ** Cache hit");
			console.debug(cachedResponse);
			return res.json(cachedResponse);
		}
		console.log(" ** Cache miss");

		// Forward the request to USPS
		const uspsRes = await backOff(async () => {
			const accessToken = await tokenHolder.fetch();
			const response = await fetch(
				`https://apis.usps.com/addresses/v3/address?${queryString}`,
				{
					headers: {
						"Authorization": `Bearer ${accessToken}`,
						"Accept": "application/json",
					},
				},
			);
			if (response.status === 401) {  // Unauthorized
				console.warn(" ** USPS: Received Unauthorized");
				tokenHolder.invalidate();
				throw new ShouldRetry();
			}
			return response;
		}, {
			retry: (err) => err instanceof ShouldRetry,
		});

		// Parse the response from USPS
		const uspsBody = await uspsRes.json();
		console.debug(uspsBody);

		// Make sure the USPS response looks as we expect
		if (!validateUspsResponse(uspsBody)) {
			console.error(" ** Unrecognized response from USPS");
			res.sendStatus(502);  // Bad Gateway
			return;
		}

		// Cache the USPS response if 2xx
		if (uspsRes.status >= 200 && uspsRes.status < 300) {
			cache.set(queryString, uspsBody);
		} else {
			console.log(" ** Response was not 2xx; not caching");
		}

		// Set CORS headers on our own response
		res.header("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN);
		res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		// I *believe* we just need the default allowlist
		// res.header("Access-Control-Allow-Headers", "*");

		// Respond back to the user with USPS's response
		res.json(uspsBody);
	},
);


app.listen(port, "0.0.0.0", () => console.log(`Listening on port ${port}`));
