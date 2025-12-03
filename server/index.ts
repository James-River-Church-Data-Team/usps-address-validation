import express from "express";
import { query } from "express-validator";
import LRUMap_pkg from "lru_map";
import { TokenHolder } from "./token-holder.js";

const { LRUMap } = LRUMap_pkg;


const port = process.env.PORT ?? 10_000;

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
		if (
			req.socket.remoteAddress === undefined
			|| !ALLOWED_IPS.includes(req.socket.remoteAddress)
		) {
			return;
		}
		next();
	},

	// Validate query params
	query("streetAddress").isString(),
	query("city").isString(),
	query("state").isString(),
	query("zip").isString(),
	query("country").isString(),

	async (req, res) => {
		// Serialize query for our own purposes
		const queryString = new URLSearchParams(req.query).toString();

		// Short-circuit from cache
		const cachedResponse = cache.get(queryString);
		if (cachedResponse !== undefined) return res.json(cachedResponse);

		// Forward the request to USPS
		const accessToken = await tokenHolder.fetch();
		const uspsRes = await fetch(
			`https://apis.usps.com/addresses/v3/address?${queryString}`,
			{
				headers: {
					"Authorization": `Bearer ${accessToken}`,
					"Accept": "application/json",
				},
			},
		);

		// Parse the response from USPS
		const uspsBody = await uspsRes.json();

		// Make sure the USPS response looks as we expect
		if (!validateUspsResponse(uspsBody)) {
			res.sendStatus(502);
			return;
		}

		// Cache the USPS response if 2xx
		if (uspsRes.status >= 200 && uspsRes.status < 300) {
			cache.set(queryString, uspsBody);
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


app.listen(port, () => console.log(`Listening on port ${port}`));
