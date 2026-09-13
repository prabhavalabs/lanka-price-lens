import assert from "node:assert/strict";
import test from "node:test";

import { changePasswordSchema, loginSchema, registerSchema } from "@lanka-pricelens/shared";

import { AccountApiError } from "../src/lib/account-api.ts";
import { confirmError, describeAccountError, describeUserAgent, fieldErrors, initials, locationPath, plainMessage, safeReturnTo, validate, withReturnTo } from "../src/lib/account-forms.ts";

test("return_to accepts only paths on this site and never loops back into the sign-in pages", () => {
  assert.equal(safeReturnTo("/menus"), "/menus");
  assert.equal(safeReturnTo("/r/dish_pol_sambol?servings=6"), "/r/dish_pol_sambol?servings=6");
  assert.equal(safeReturnTo("  /account  "), "/account", "surrounding whitespace is trimmed");
  for (const bad of [null, undefined, "", "   ", "https://evil.example", "//evil.example/path", "/\\evil.example", "javascript:alert(1)", "menus", "/with space", "/tab\there", "/line\nbreak", `/${"a".repeat(2000)}`]) {
    assert.equal(safeReturnTo(bad), "/", `${JSON.stringify(bad)} falls back`);
  }
  assert.equal(safeReturnTo("/basket", "/menus"), "/basket");
  assert.equal(safeReturnTo("//evil.example", "/menus"), "/menus", "the fallback is used when given");
  for (const loop of ["/account/login", "/account/login?return_to=%2F", "/account/register", "/account/forgot", "/account/reset?token=abc"]) {
    assert.equal(safeReturnTo(loop), "/", `${loop} would loop`);
  }
  assert.equal(safeReturnTo("/account/verify?token=abc"), "/account/verify?token=abc", "the verify page is a fine destination");
  assert.equal(safeReturnTo("/account/recipes"), "/account/recipes");
});

test("links to the account pages carry the way back only when there is one", () => {
  assert.equal(withReturnTo("/account/login", "/menus/abc"), "/account/login?return_to=%2Fmenus%2Fabc");
  assert.equal(withReturnTo("/account/login", "/"), "/account/login");
  assert.equal(withReturnTo("/account/login", null), "/account/login");
  assert.equal(withReturnTo("/account/register", "https://evil.example"), "/account/register");
  assert.equal(withReturnTo("/account/register", "/account/login"), "/account/register", "a sign-in page is not a destination");
  assert.equal(locationPath({ pathname: "/r/dish_kiribath", search: "?servings=4" }), "/r/dish_kiribath?servings=4");
  assert.equal(locationPath({ pathname: "/", search: "" }), "/");
});

test("schema issues land under their fields, first issue per field, with plain wording", () => {
  const result = validate(registerSchema, { email: "not an address", password: "short", display_name: "  " });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors, { email: "That email address does not look right", password: "Use at least ten characters", display_name: "Tell us what to call you" });

  const login = validate(loginSchema, { email: "Person@Example.com ", password: "" });
  assert.equal(login.ok, false);
  if (login.ok) return;
  assert.deepEqual(login.errors, { password: "Fill this in" }, "zod's developer wording is rewritten");

  const good = validate(loginSchema, { email: " Person@Example.com ", password: "correct horse battery", remember: false });
  assert.equal(good.ok, true);
  if (!good.ok) return;
  assert.deepEqual(good.data, { email: "person@example.com", password: "correct horse battery", remember: false }, "the schema's own normalisation is what gets sent");

  assert.deepEqual(fieldErrors([{ path: ["a"], message: "first" }, { path: ["a"], message: "second" }, { path: [], message: "Too small: expected string to have >=1 characters" }]), { a: "first", form: "Fill this in" });
  assert.equal(plainMessage("Too big: expected string to have <=80 characters"), "That is too long");
  assert.equal(plainMessage("Invalid input: expected \"DELETE\""), "That is not right");
  assert.equal(plainMessage("Use at least ten characters"), "Use at least ten characters", "custom messages pass through");
});

test("a repeated password is checked alongside the schema", () => {
  assert.deepEqual(confirmError("", ""), {}, "nothing to compare yet");
  assert.deepEqual(confirmError("correct horse battery", ""), { confirm: "Type the new password again" });
  assert.deepEqual(confirmError("correct horse battery", "correct horse batter"), { confirm: "The two passwords do not match" });
  assert.deepEqual(confirmError("correct horse battery", "correct horse battery"), {});
  assert.deepEqual(confirmError("abc", "abd", "again"), { again: "The two passwords do not match" });
  const result = validate(changePasswordSchema, { current_password: "old one", new_password: "correct horse battery" }, confirmError("correct horse battery", "nope"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors, { confirm: "The two passwords do not match" }, "extra errors fail an otherwise valid form");
});

test("API failures are explained in plain words by code, then status, then message", () => {
  const cases: Array<[AccountApiError, RegExp]> = [
    [new AccountApiError(401, "Unauthorized", "INVALID_CREDENTIALS"), /do not match/u],
    [new AccountApiError(423, "Locked", "ACCOUNT_LOCKED"), /fifteen minutes/u],
    [new AccountApiError(403, "Disabled", "ACCOUNT_DISABLED"), /disabled/u],
    [new AccountApiError(409, "Taken", "EMAIL_TAKEN"), /already exists/u],
    [new AccountApiError(400, "Bad token", "TOKEN_INVALID"), /no longer valid/u],
    [new AccountApiError(403, "Wrong", "PASSWORD_WRONG"), /not right/u],
    [new AccountApiError(400, "Need it", "PASSWORD_REQUIRED"), /password is needed/u],
    [new AccountApiError(403, "Verify", "EMAIL_NOT_VERIFIED"), /Verify your email/u],
    [new AccountApiError(429, "Slow down", "RATE_LIMITED"), /Too many tries/u],
    [new AccountApiError(401, "Session gone", null), /session has ended/u],
    [new AccountApiError(429, "Too many requests", null), /Too many tries/u],
    [new AccountApiError(400, "The API's own words", "SOMETHING_NEW"), /^The API's own words$/u],
  ];
  for (const [error, pattern] of cases) assert.match(describeAccountError(error), pattern, `${error.code ?? error.status}`);
  assert.equal(describeAccountError(new Error("Could not reach PriceLens.")), "Could not reach PriceLens.");
  assert.match(describeAccountError(undefined), /Something went wrong/u);
  assert.match(describeAccountError("nonsense"), /Something went wrong/u);
});

test("initials and user agents read as a person would say them", () => {
  assert.equal(initials("Nipun Theekshana"), "NT");
  assert.equal(initials("  amara  "), "A");
  assert.equal(initials("Ann Marie Jones"), "AM", "two letters at most");
  assert.equal(initials("සුනිල් පෙරේරා"), "සුපෙ", "works outside ASCII");
  assert.equal(initials(""), "?");
  assert.equal(initials("   ", "E"), "E", "the fallback is used for a blank name");

  assert.equal(describeUserAgent(null), "Unknown device");
  assert.equal(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"), "Chrome on Mac");
  assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), "Safari on iPhone");
  assert.equal(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0"), "Edge on Windows");
  assert.equal(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0"), "Firefox on Linux");
  assert.equal(describeUserAgent("curl/8.6.0"), "A browser");
});
