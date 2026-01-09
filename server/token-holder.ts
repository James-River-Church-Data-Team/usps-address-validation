import { backOff } from "exponential-backoff";
import { ShouldRetry } from "./common.js";
import { USPS_CLIENT_IDS, USPS_CLIENT_SECRETS } from "./env.js";


export interface Token {
	id: number;
	data: string;
}

export class TokenHolder {
	#tokens: (string | null)[] = [];
	#index: number = 0;

	async fetch(): Promise<Token> {
		const data = this.#tokens[this.#index]
			?? await TokenHolder.#regenerateToken(this.#index);
		this.#tokens[this.#index] = data;
		const result = { id: this.#index, data };
		this.#index = (this.#index + 1) % USPS_CLIENT_IDS.length;
		return result;
	}

	invalidate(id: number): void {
		this.#tokens[id] = null;
	}

	static async #regenerateToken(id: number): Promise<string> {
		return backOff(() => TokenHolder.#_regenerateToken(id), {
			retry: (err) => err instanceof ShouldRetry,
		});
	}

	static async #_regenerateToken(id: number): Promise<string> {
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
				client_id:     USPS_CLIENT_IDS    [id],
				client_secret: USPS_CLIENT_SECRETS[id],
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
