// ==UserScript==
// @name         USPS Address Validation - View Page
// @namespace    https://github.com/nate-kean/
// @version      20251029
// @description  Integrate USPS address validation into the Address field.
// @author       Nate Kean
// @match        https://jamesriver.fellowshiponego.com/members/view/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=fellowshiponego.com
// @grant        none
// @license      MIT
// ==/UserScript==

// This project wound up closely following the View-Model-Controller pattern:
// - The logic here in the userscript file is the Controller.
// - Validator is the Model.
// - Indicator is the View.
// The Controller, here, sends new addresses to the Validator; the Validator
// then uses the Indicator to put info on the DOM and receive user input;
// and the Indicator sends user input back here, to the controller.


/**
 * Entry point for the program.
 * Holds the View-page-specific logic for capturing addresses.
 */
(async function controller() {
	/**
	 * @returns {string}
	 */
	function getStreetAddress() {
		// If the individual has an Address Validation flag, ignore the first
		// line of the street address, because it's probably a message about the
		// address.
		const addDetailsKeys = document.querySelectorAll(
			".other-panel > .panel-body > .info-left-column > .other-lbl"
		);
		let iStartStreetAddr = 0;
		for (const key of addDetailsKeys) {
			const hasAddrValEntry = key.textContent.trim() === "Address Validation";
			const streetAddrOneLine = streetAddressEl.childNodes.length <= 1;
			if (hasAddrValEntry && !streetAddrOneLine) {
				// Skip first two nodes within the street address element:
				// The address validation message, and the <br /> underneath it.
				iStartStreetAddr = 2;
				break;
			}
		}
		// Construct the street address, ignoring beginning lines if the above
		// block says to, and using spaces instead of <br />s or newlines.
		let streetAddress = "";
		for (let i = iStartStreetAddr; i < streetAddressEl.childNodes.length; i++) {
			streetAddress += streetAddressEl.childNodes[i].textContent.trim();
			if (i + 1 !== streetAddressEl.childNodes.length) {
				streetAddress += " ";
			}
		}
		return streetAddress;
	}

	const addressPanel = document.querySelector(".address-panel");
	const heading = addressPanel.querySelector(".panel-heading");
	const indicator = new Indicator(heading);
	indicator.button.addEventListener("click", () => {
		// Act on the correction the indicator is suggesting.
		if (indicator.indicating.corrs <= 0) return;

		// TODO(Nate): what in sam hill is .filter(Boolean)
		const f1UID = window.location.pathname.split("/").filter(Boolean).pop();

		// TODO(Nate): Leave a message in sessionStorage for the Indicator on
		// the Edit page to pick up that will tell it to fill in the canonical
		// address the Validator came up with as soon as the page loads.
		// - It should then delete this message so it doesn't do it again
		// - The message should be bundled with a timestamp so that it only does
		//   this if it was commanded recently. (in case you like leave the page
		//   before it runs. dont want it to fire 5 hours later when you happen
		//   back to the page. that would stink)

		window.location.href = `/members/edit/${f1UID}#addresslabel1_chosen`;
	});

	const detailsP = addressPanel.querySelector(
		".panel-body > .info-right-column > .address-details > p"
	);
	const streetAddressEl = detailsP.children[0];

	const streetAddress = getStreetAddress();
	const line2 = detailsP.children[1].textContent.trim();
	const line2Chunks = line2.split(",");
	const city = line2Chunks[0];
	const [state, zip] = line2Chunks[1].trim().split(" ");
	const country = detailsP.children[2].textContent.trim();

	Validator.onNewAddress(indicator, { streetAddress, city, state, zip, country });
})();
