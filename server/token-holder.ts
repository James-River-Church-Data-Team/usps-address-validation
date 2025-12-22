import { backOff } from "exponential-backoff";
import { ShouldRetry } from "./common.js";
import { USPS_CLIENT_ID, USPS_CLIENT_SECRET } from "./env.js";


export class TokenHolder {
	#accessToken: string | null = null;

	async fetch(): Promise<string | null> {
		if (this.#accessToken === null) {
			this.#accessToken = await this.#regenerateToken();
		}
		return this.#accessToken;
	}

	invalidate(): void {
		this.#accessToken = null;
	}

	async #regenerateToken(): Promise<string> {
		return backOff(this.#_regenerateToken.bind(this), {
			retry: (err) => err instanceof ShouldRetry,
		});
	}

	async #_regenerateToken(): Promise<string> {
		console.log(" ** Regenerating token");
		const response = await fetch(
			"https://apis.usps.com/oauth2/v3/token", {
			method: "POST",
			headers: new Headers({
				"Content-Type": "application/json",
			}),
			body: JSON.stringify({
				grant_type: "client_credentials",
				scope: "addresses",
				client_id:     USPS_CLIENT_ID,
				client_secret: USPS_CLIENT_SECRET,
			}),
		});
		switch (response.status) {
			case 200:
				console.log("     ** Successfully regenerated token");
				break;
			case 429:
			case 503:
				console.warn(`    ** Received ${response.status}`);
				throw new ShouldRetry();
			default:
				throw new Error(`${response.status} ${response.statusText}`);
		}
		const json = await response.json();
		if (
			typeof json !== "object"
			|| json === null
			|| !("access_token" in json)
			|| typeof json.access_token !== "string"
		) {
			throw new Error(`${response.status} ${response.statusText}`);
		}
		return json.access_token;
	}
}
