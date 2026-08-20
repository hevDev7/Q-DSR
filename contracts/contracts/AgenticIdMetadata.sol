// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title AgenticIdMetadata
 * @notice Builds an ERC-721 metadata document entirely on chain.
 *
 * The certification numbers are the point of this token, so they travel with it
 * rather than living behind a URL someone has to keep serving. A wallet reading
 * `tokenURI` gets the Deflated Sharpe Ratio and the Probability of Backtest
 * Overfitting as attributes, from the same registry that gated the mint.
 *
 * Only the artwork is fetched: the image field points at 0G Storage when the
 * owner supplied one, and otherwise falls back to an SVG generated here, so a
 * token always renders even with nothing uploaded.
 */
library AgenticIdMetadata {
    struct View {
        string name;
        string description;
        string image;
        string evidenceURI;
        uint32 dsrBps;
        uint32 pboBps;
        uint32 trials;
        uint32 observations;
        bool certified;
        uint256 tokenId;
    }

    /// @dev Renders basis points as a decimal, e.g. 9982 -> "0.9982".
    function _probability(uint32 bps) internal pure returns (string memory) {
        uint256 whole = bps / 10_000;
        uint256 frac = bps % 10_000;
        bytes memory padded = bytes(Strings.toString(frac));
        bytes memory out = new bytes(4);
        uint256 offset = 4 - padded.length;
        for (uint256 i = 0; i < 4; i++) {
            out[i] = i < offset ? bytes1("0") : padded[i - offset];
        }
        return string.concat(Strings.toString(whole), ".", string(out));
    }

    /// @dev JSON string escaping. Only quotes and backslashes can appear here in
    ///      practice, but an unescaped one would corrupt the whole document.
    function _escape(string memory input) internal pure returns (string memory) {
        bytes memory raw = bytes(input);
        bytes memory out = new bytes(raw.length * 2);
        uint256 n = 0;
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 c = raw[i];
            if (c == '"' || c == "\\") {
                out[n++] = "\\";
                out[n++] = c;
            } else if (uint8(c) >= 0x20) {
                out[n++] = c;
            }
        }
        bytes memory trimmed = new bytes(n);
        for (uint256 i = 0; i < n; i++) trimmed[i] = out[i];
        return string(trimmed);
    }

    function _svg(View memory v) internal pure returns (string memory) {
        string memory accent = v.certified ? "#c8f169" : "#ed7770";
        string memory verdict = v.certified ? "CERTIFIED" : "NOT SIGNIFICANT";
        return
            string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">',
                '<rect width="600" height="600" fill="#0b1013"/>',
                '<rect x="28" y="28" width="544" height="544" rx="22" fill="#0f1719" stroke="#243030"/>',
                '<text x="60" y="96" fill="#6e7a70" font-family="monospace" font-size="15" letter-spacing="5">Q-DSR AGENTIC ID</text>',
                '<text x="60" y="176" fill="#e9f0e4" font-family="sans-serif" font-size="40" font-weight="800">',
                _escape(v.name),
                "</text>",
                '<text x="60" y="214" fill="#6fe0dc" font-family="monospace" font-size="17">#',
                Strings.toString(v.tokenId),
                "</text>",
                '<text x="60" y="326" fill="#6e7a70" font-family="monospace" font-size="15">DEFLATED SHARPE RATIO</text>',
                '<text x="60" y="386" fill="',
                accent,
                '" font-family="monospace" font-size="60">',
                _probability(v.dsrBps),
                "</text>",
                '<text x="330" y="326" fill="#6e7a70" font-family="monospace" font-size="15">PROB. OF OVERFITTING</text>',
                '<text x="330" y="386" fill="',
                accent,
                '" font-family="monospace" font-size="60">',
                _probability(v.pboBps),
                "</text>",
                '<text x="60" y="470" fill="#6e7a70" font-family="monospace" font-size="14">',
                Strings.toString(v.trials),
                " CONFIGURATIONS TESTED OVER ",
                Strings.toString(v.observations),
                " OBSERVATIONS</text>",
                '<rect x="60" y="500" width="',
                v.certified ? "150" : "220",
                '" height="34" rx="17" fill="',
                accent,
                '" fill-opacity="0.14" stroke="',
                accent,
                '" stroke-opacity="0.5"/>',
                '<text x="78" y="523" fill="',
                accent,
                '" font-family="monospace" font-size="15" letter-spacing="2">',
                verdict,
                "</text></svg>"
            );
    }

    function tokenURI(View memory v) internal pure returns (string memory) {
        string memory image = bytes(v.image).length > 0
            ? _escape(v.image)
            : string.concat(
                "data:image/svg+xml;base64,",
                Base64.encode(bytes(_svg(v)))
            );

        string memory json = string.concat(
            '{"name":"',
            _escape(v.name),
            " #",
            Strings.toString(v.tokenId),
            '","description":"',
            _escape(v.description),
            '","image":"',
            image,
            '","external_url":"',
            _escape(v.evidenceURI),
            '","attributes":[',
            '{"trait_type":"Verdict","value":"',
            v.certified ? "Certified" : "Not significant",
            '"},',
            '{"trait_type":"Deflated Sharpe Ratio","value":"',
            _probability(v.dsrBps),
            '"},',
            '{"trait_type":"Probability of Backtest Overfitting","value":"',
            _probability(v.pboBps),
            '"},',
            '{"trait_type":"Configurations tested","value":',
            Strings.toString(v.trials),
            "},",
            '{"trait_type":"Observations","value":',
            Strings.toString(v.observations),
            "}]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
