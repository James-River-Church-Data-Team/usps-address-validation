import { backOff } from "exponential-backoff";
import { ShouldRetry } from "./common.js";


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
		const response = await fetch(
			"https://apis.usps.com/oauth2/v3/token", {
			method: "POST",
			headers: new Headers({
				"Content-Type": "application/json",
			}),
			body: JSON.stringify({
				grant_type: "client_credentials",
				scope: "addresses",
				client_id:     process.env.USPS_CLIENT_ID,
				client_secret: process.env.USPS_CLIENT_SECRET,
			}),
		});
		switch (response.status) {
			case 200:
				break;
			case 429:
			case 503:
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
