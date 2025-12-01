// ==UserScript==
// @name         USPS Address Validation - View Page
// @namespace    https://github.com/nate-kean/
// @version      20251117
// @description  Integrate USPS address validation into the Address field.
// @author       Nate Kean
// @match        https://jamesriver.fellowshiponego.com/members/view/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=fellowshiponego.com
// @grant        none
// @license      MIT
// @require      https://update.greasyfork.org/scripts/555040/1700502/USPS%20Address%20Validation%20-%20Common.js
// ==/UserScript==


/**
 * Entry point for the program.
 * Holds the View-page-specific logic for capturing addresses.
 */
// @ts-check
(async () => {
	/**
	 * @param {string[]} streetAddrLines
	 * @returns {string}
	 */
	function normalizeStreetAddressQuery(streetAddrLines) {
		// If the individual has an Address Validation flag, ignore the first
		// line of the street address, because it's probably a message about the
		// address.
		const addDetailsKeys = document.querySelectorAll(
			".other-panel > .panel-body > .info-left-column > .other-lbl"
		);
		let iStartStreetAddr = 0;
		if (streetAddrLines.length > 1) {
			for (const key of addDetailsKeys) {
				if (key.textContent.trim() !== "Address Validation") continue;
				// Skip first two nodes within the street address element:
				// The address validation message, and the <br /> underneath it.
				iStartStreetAddr = 1;
				break;
			}
		}
		// Construct the street address, ignoring beginning lines if the above
		// block says to, and using spaces instead of <br />s or newlines.
		let streetAddress = "";
		for (let i = iStartStreetAddr; i < streetAddrLines.length; i++) {
			const text = streetAddrLines[i];
			streetAddress += text.trim();
			if (i + 1 !== streetAddrLines.length) {
				streetAddress += " ";
			}
		}
		return streetAddress;
	}

	const addressPanel = tryQuerySelector(document, ".address-panel");
	const heading = tryQuerySelector(addressPanel, ".panel-heading");
	const validator = new Validator();
	const indicator = new Indicator(heading);

	const detailsP = tryQuerySelector(
		addressPanel,
		".panel-body > .info-right-column > .address-details > p",
	);
	const streetAddressEl = detailsP.children[0];
	const streetAddrLines = [];
	for (const child of streetAddressEl.childNodes) {
		if (!child.textContent) continue;
		streetAddrLines.push(child.textContent.trim());
	}

	const streetAddress = normalizeStreetAddressQuery(streetAddrLines);
	const line2 = detailsP.children[1].textContent.trim();
	const line2Chunks = line2.split(",");
	const city = line2Chunks[0];
	const [state, zip] = line2Chunks[1].trim().split(" ");
	const country = detailsP.children[2].textContent.trim();

	validator.onNewAddressQuery(
		indicator,
		{ streetAddress, city, state, zip, country },
	);

	indicator.button.addEventListener("click", () => {
		// Act on the correction the indicator is suggesting.
		if (indicator.status.code !== Validator.Code.CORRECTION) return;

		// TODO(Nate): what in sam hill is .filter(Boolean)
		const f1UID = window.location.pathname.split("/").filter(Boolean).pop();

		// TODO(Nate): support profiles with two addresses
		window.location.href = `/members/edit/${f1UID}?autofill-addr=1#addresslabel1_chosen`;
	});
})();
