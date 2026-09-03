#!/usr/bin/env node

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PI_HOST_IDENTITY, withPiHostIdentity } from "../src/host-identity.js";

describe("Pi host identity", () => {
	it("identifies Pi as the user-facing harness even without other appended instructions", () => {
		assert.equal(withPiHostIdentity(), PI_HOST_IDENTITY);
		assert.match(PI_HOST_IDENTITY, /user is interacting with Pi, not Claude Code/);
		assert.match(PI_HOST_IDENTITY, /Claude Agent SDK are only the provider runtime/);
	});

	it("keeps projected instructions after the identity boundary", () => {
		assert.equal(
			withPiHostIdentity("project instructions"),
			`${PI_HOST_IDENTITY}\n\nproject instructions`,
		);
	});
});
