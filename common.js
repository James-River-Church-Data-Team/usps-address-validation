document.head.insertAdjacentHTML("beforeend", `
	<style id="data-team-address-validator-css">
		.address-panel {
			position: relative;
		}

		.data-team-address-validation-indicator {
			float: right;
			font-size: 16px;
			font-weight: 600;
			width: 24px;
			height: 24px;
			text-align: center;
			padding-top: 4px;
		}

		.data-team-address-validation-indicator.fa-check {
			color: #00c853;
		}

		.data-team-address-validation-indicator.fa-exclamation {
			color: #ff8f00;
			cursor: pointer;
			background-color: hsla(0, 0%, 100%, .1);
			border-radius: 6px;
			transition: background-color 100ms;
		}

		.data-team-address-validation-indicator.fa-times {
			color: #c84040
		}

		.data-team-address-validation-indicator + .tooltip > .tooltip-inner {
			max-width: 250px !important;
		}
	</style>
`);


/**
 * @typedef {Object} Address
 * @property {string} streetAddress
 * @property {string} city
 * @property {string} state
 * @property {string} zip
 * @property {string} country
 */

/**
 * Validation Result
 * @typedef {Object} ValResult
 * @property {Validator.Code} code
 * @property {string} msg
 * @property {number} corrs - correction count
 */


/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
	return str.replace(
		/\w\S*/g,
		text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
	);
}


class Validator {
	static Code = Object.freeze({
		MATCH: 0,
		CORRECTION: 1,
		NOT_FOUND: 2,
		NOPE: 3,
		ERROR: 4,
		NOT_IMPL: 5,
	});

	static #USPS_API_CLIENT_ID = "6mnicGgTpkmQ3gkf6Nr7Ati8NHhGc4tuGTwca3v4AsPGKIBL";
	static #USPS_API_CLIENT_SECRET = "IUvAMfzOAAuDAn23yAylO1J9Y3MvE8AtDywW6SDPpvrazGmAvwOHLgJWs4Gkoy2w";

	static #DEFAULT_BACKOFF = 4000;
	static #backoff = DEFAULT_BACKOFF;

	/**
	 * Call when there is a new address to validate.
	 * @param {Indicator} indicator
	 * @param {Address} address
	 * @returns {Promise<void>}
	 */
	static async onNewAddress(indicator, address) {
		const cached = Validator.#getFromCache(address);
		if (cached !== null) {
			indicator.display(result);
			return;
		};
		const result = await Validator.#validate(address);
		Validator.#sendToCache(address, result);
		indicator.display(result);
	}

	/**
	 * @param {Address} address
	 * @returns {Promise<ValResult>}
	 */
	static async #validate({ streetAddress, city, state, zip, country }) {
		// We have to check this ourselves because USPS very curiously returns
		// HTTP 400 if it's not right. (Like. why not just return a correction?)
		if (state !== state.toUpperCase()) {
			return {
				code: Validator.Code.CORRECTION,
				msg: (
					`${streetAddress.replace("\n", "<br>")}<br>${city}, `
					+ `<strong>${state.toUpperCase()}</strong> ${zip}`
				),
				corrs: 1,
			};
		}

		if (country.length == 2 && country !== "US")
			return { code: Validator.Code.NOPE, msg: "", corrs: 0 };

		// Handle being timed out on a previous page
		const prevBackoff = window.sessionStorage.getItem("ndk usps 402");
		if (prevBackoff !== null) {
			const prevBackoffDate = new Date(prevBackoff);
			const prelimBackoff = (
				prevBackoffDate.getMilliseconds()
				- (new Date().getMilliseconds())
			);
			await delay(prelimBackoff);
			window.sessionStorage.removeItem("ndk usps 402");
		}

		const accessToken = await Validator.#getAccessToken();
		streetAddress = toTitleCase(streetAddress);
		city = toTitleCase(city);
		const zipParts = zip?.split("-") ?? [];
		const zip5 = zipParts[0] ?? "";
		const zip4 = zipParts[1] ?? "";
		const params = {};
		// Only include entries that are populated; empty string causes HTTP 400
		if (streetAddress) params.streetAddress = streetAddress;
		if (city) params.city = city;
		if (state) params.state = state;
		if (zip5) params.ZIPCode = zip5;
		if (zip4) params.ZIPPlus4 = zip4;
		const payloadURL = (
			"https://corsproxy.io/?url="
			+ "https://apis.usps.com/addresses/v3/address?"
			+ new URLSearchParams(params).toString()
		);
		const response = await fetch(payloadURL, {
			headers: new Headers({
				"Authorization": "Bearer " + accessToken,
			}),
		}
		);
		switch (response.status) {
			case 200:
				break;
			case 401:
				await Validator.#regenerateToken();
				return await Validator.#validate(...arguments);
			case 404:
				return { code: Validator.Code.NOT_FOUND, msg: "", corrs: 0 };
			case 429:
			case 503: {
				// Exponential backoff retry
				const timeoutDate = new Date();
				timeoutDate.setMilliseconds(
					timeoutDate.getMilliseconds() + Validator.#backoff
				);
				window.sessionStorage.setItem("ndk usps 402", timeoutDate);
				await delay(Validator.#backoff);
				Validator.#backoff **= 2;
				const validatePromise = Validator.#validate(...arguments);
				Validator.#backoff = Validator.#DEFAULT_BACKOFF;
				window.sessionStorage.removeItem("ndk usps 402");
				return await validatePromise;
			}
			default:
				return {
					code: Validator.Code.ERROR,
					msg: `USPS returned status code ${response.status}`,
					corrs: 0,
				};
		}
		const json = await response.json();

		let note = "";
		let correctionCount = 0;
		const code = json.corrections[0]?.code || json.matches[0]?.code;
		switch (code) {
			case "31":
				break;
			case "32":
				note = "Missing apartment, suite, or box number.";
				correctionCount++;
				break;
			case "22":
				note = json.corrections[0].text;
				correctionCount++;
				break;
			default:
				return {
					code: Validator.Code.NOT_IMPL,
					msg: `Status code ${code} not implemented`,
					corrs: 0,
				};
		}
		const canonicalAddr = {
			streetAddress: toTitleCase(
				`${json.address.streetAddress} ${json.address.secondaryAddress}`
			).trim(),
			city: toTitleCase(json.address.city),
			state: json.address.state,
			zip5: json.address.ZIPCode,
			zip4: json.address.ZIPPlus4,
		};
		let new_addr = "";
		if (canonicalAddr.streetAddress === streetAddress) {
			new_addr += streetAddress;
		} else {
			new_addr += `<strong>${canonicalAddr.streetAddress}</strong>`;
			correctionCount++;
		}
		new_addr += "<br>";
		if (canonicalAddr.city === city) {
			new_addr += city;
		} else {
			new_addr += `<strong>${canonicalAddr.city}</strong>`;
			correctionCount++;
		}
		new_addr += ", ";
		if (canonicalAddr.state === state) {
			new_addr += state;
		} else {
			new_addr += `<strong>${canonicalAddr.state}</strong>`;
			correctionCount++;
		}
		new_addr += " ";
		if (canonicalAddr.zip5 === zip5 && canonicalAddr.zip4 === zip4) {
			new_addr += `${zip5}-${zip4}`;
		} else {
			new_addr += `<strong>${canonicalAddr.zip5}-${canonicalAddr.zip4}</strong>`;
			correctionCount++;
		}
		if (correctionCount > 0) {
			return {
				code: Validator.Code.CORRECTION,
				msg: `<span>${new_addr}${note ? `<br><i>${note}</i>` : ""}</span>`,
				corrs: correctionCount,
			};
		} else {
			return { code: Validator.Code.MATCH, msg: "", corrs: 0 };
		}
	}

	/**
	 * @returns {Promise<string | null>}
	 */
	static async #getAccessToken() {
		let accessToken = window.localStorage.getItem("natesUSPSAccessToken");
		if (accessToken === "null" || accessToken === null) {
			await Validator.#regenerateToken();
			accessToken = window.localStorage.getItem("natesUSPSAccessToken");
		}
		return accessToken;
	}

	/**
	 * @returns {Promise<void>}
	 */
	static async #regenerateToken() {
		const response = await fetch(
			"https://corsproxy.io/?url=https://apis.usps.com/oauth2/v3/token", {
			method: "POST",
			headers: new Headers({
				"Content-Type": "application/json",
			}),
			body: JSON.stringify({
				grant_type: "client_credentials",
				scope: "addresses",
				client_id: Validator.#USPS_API_CLIENT_ID,
				client_secret: Validator.#USPS_API_CLIENT_SECRET,
			}),
		});
		switch (response.status) {
			case 200:
				break;
			case 429:
			case 503: {
				// Exponential backoff retry
				const timeoutDate = new Date();
				timeoutDate.setMilliseconds(
					timeoutDate.getMilliseconds() + Validator.#backoff
				);
				window.sessionStorage.setItem("ndk usps 402", timeoutDate);
				await delay(Validator.#backoff);
				Validator.#backoff **= 2;
				const validatePromise = Validator.#regenerateToken();
				Validator.#backoff = Validator.#DEFAULT_BACKOFF;
				window.sessionStorage.removeItem("ndk usps 402");
				return await validatePromise;
			}
			default:
				throw Error(response);
		}
		const json = await response.json();
		window.localStorage.setItem("natesUSPSAccessToken", json.access_token);
	}

	/**
	 * @param {Address} address
	 * @returns {string}
	 */
	static #serializeAddress({ streetAddress, city, state, zip, country }) {
		return `ndk ${streetAddress} ${city} ${state} ${zip} ${country}`;
	}

	/**
	 * @param {Address} address
	 * @returns {ValResult}
	 */
	static #getFromCache(address) {
		const key = Validator.#serializeAddress(address);
		const value = window.sessionStorage.getItem(key);
		return JSON.parse(value);
	}

	/**
	 * @param {Address} address
	 * @param {ValResult} result
	 * @returns {void}
	 */
	static #sendToCache(address, result) {
		if (
			result[0] === Validator.Code.ERROR
			|| result[0] === Validator.Code.NOT_IMPL
		) return;
		const key = Validator.#serializeAddress(address);
		const value = JSON.stringify(result);
		window.sessionStorage.setItem(key, value);
	}
}


class Indicator {
	#icon;

	/**
	 * @param {Node} parent
	 */
	constructor(parent) {
		/**
		 * @type {HTMLButtonElement}
		 */
		this.button = document.createElement("button");
		/**
		 * @type {HTMLElement}
		 */
		this.#icon = document.createElement("i");
		/**
		 * @type {ValResult | null}
		 */
		this.indicating = null;

		this.#icon.classList.add("data-team-address-validation-indicator");
		this.#icon.setAttribute("data-toggle", "tooltip");
		this.#icon.setAttribute("data-placement", "top");
		this.#icon.setAttribute("data-html", "true");
		this.#icon.classList.add("fal", "fa-spinner-third", "fa-spin");
		$(this.#icon).tooltip();
		button.appendChild(this.#icon);
		parent.appendChild(this.button);
	}

	/**
	 * @param {ValResult} result
	 * @returns {void}
	 */
	display(result) {
		this.indicating = result;
		const { code, msg, corrs: correctionCount } = this.indicating;
		let tooltipContent = "";

		this.#icon.classList.remove("fa-spinner-third", "fa-spin");
		switch (code) {
			case Validator.Code.MATCH:
				this.#icon.classList.add("fa-check");
				tooltipContent = "USPS — Verified valid";
				break;
			case Validator.Code.CORRECTION:
				this.#icon.classList.add("fa-exclamation");
				const s = correctionCount > 1 ? "s" : "";
				tooltipContent = `USPS — Correction${s} suggested:<br>${msg}`;
				break;
			case Validator.Code.NOT_FOUND:
				this.#icon.classList.add("fa-times");
				tooltipContent = "USPS — Address not found";
				break;
			case Validator.Code.NOPE:
				this.#icon.classList.add("fa-circle");
				tooltipContent = "USPS validation skipped: incompatible country";
				break;
			case Validator.Code.ERROR:
				this.#icon.classList.add("fa-times");
				tooltipContent = `ERROR: ${msg}. Contact Nate`;
				break;
			case Validator.Code.NOT_IMPL:
				this.#icon.classList.add("fa-times");
				tooltipContent = `ERROR: ${msg}. Contact Nate`;
				break;
			default:
				this.#icon.classList.add("fa-times");
				tooltipContent = "PLUGIN ERROR: contact Nate";
				break;
		}
		this.#icon.setAttribute("data-original-title", tooltipContent);
	}
}
