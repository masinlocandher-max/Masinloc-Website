-- SECURITY-NEUTRALIZED LOCAL REPRESENTATION.
--
-- Production version 20260829105707 was a temporary QA fixture migration that
-- created two controlled test merchants and two test auth users. Its original
-- statement embedded test passwords, so reproducing it verbatim in this public
-- repository would publish credentials and make future restores unsafe.
--
-- Production migration name: qa_test_merchant_fixtures
-- Production statement length: 3610 characters
-- Production md5(statements[1]): 95c671848ea82bc79d2df83ae8a6f2bb
--
-- The production QA entities are removed after the isolation/E2E test pass.
-- A fresh environment must NOT recreate those users. Keeping this versioned
-- no-op preserves migration-number parity without replaying credential-bearing
-- test data.

select 1;
