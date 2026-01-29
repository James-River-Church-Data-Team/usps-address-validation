export const PORT = process.env.PORT !== undefined
	? parseInt(process.env.PORT)
	: 10_000;

// 50,000: I expect response bodies to be ~1kb each, so this should take about
// up to 50MB of RAM.
export const CACHE_COUNT = process.env.CACHE_COUNT !== undefined
	? parseInt(process.env.CACHE_COUNT)
	: 50_000;

export const ENABLE_METRICS = process.env.ENABLE_METRICS !== undefined
	? Boolean(process.env.ENABLE_METRICS)
	: false;

const errors: Error[] = [];
export const ALLOWED_IPS: string[] = (() => {
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

function parseStringOrStringArrayEnvVar(name: string): string[] | null {
	if (process.env[name] === undefined) {
		errors.push(new Error(`Missing env var ${name}`));
		return null;
	}
	let data: unknown = JSON.parse(process.env[name]);
	if (
		typeof data !== "object"
		|| data === null
	) {
		errors.push(
			new Error(`Env var ${name} must be a string or an array of strings`)
		);
		return null;
	}
	const array = (data instanceof Array) ? data : [data];
	for (const el of array) {
		if (typeof el !== "string") {
			errors.push(
				new Error(
					`Env var ${name} must be a string or an array of strings`
				)
			);
			return null;
		}
	}
	return array;
}

const uspsClientIDs = parseStringOrStringArrayEnvVar("USPS_CLIENT_IDS");
const uspsClientSecrets = parseStringOrStringArrayEnvVar("USPS_CLIENT_SECRETS");

if (uspsClientIDs?.length !== uspsClientSecrets?.length) {
	errors.push(
		new Error("Env vars USPS_CLIENT_ID and USPS_CLIENT_SECRET must have the same length")
	);
}

if (process.env.ALLOW_ORIGIN === undefined) {
	errors.push(new Error("Missing env var ALLOW_ORIGIN"));
}

if (errors.length > 0) {
	const up = new AggregateError(errors);
	for (const err of errors) console.error(err);
	throw up;
}


export const USPS_CLIENT_IDS     = uspsClientIDs!;
export const USPS_CLIENT_SECRETS = uspsClientSecrets!;
export const ALLOW_ORIGIN        = process.env.ALLOW_ORIGIN!;
