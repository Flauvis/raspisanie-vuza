import ambiguousYear from "../../../tests/fixtures/ambiguous-year.json";
import dstBerlin from "../../../tests/fixtures/dst-berlin.json";
import emptyComplete from "../../../tests/fixtures/empty-complete.json";
import htmlTitle from "../../../tests/fixtures/html-title.json";
import indistinguishable from "../../../tests/fixtures/indistinguishable.json";
import invalidRows from "../../../tests/fixtures/invalid-rows.json";
import loggedOut from "../../../tests/fixtures/logged-out.json";
import missingRoom from "../../../tests/fixtures/missing-room.json";
import normalWeek from "../../../tests/fixtures/normal-week.json";
import partialLoading from "../../../tests/fixtures/partial-loading.json";
import sameSubjectTwice from "../../../tests/fixtures/same-subject-twice.json";
import { parseFixture, type FixtureFile } from "../fixture";

const FIXTURES: readonly FixtureFile[] = [
  normalWeek,
  emptyComplete,
  partialLoading,
  loggedOut,
  missingRoom,
  invalidRows,
  ambiguousYear,
  dstBerlin,
  htmlTitle,
  sameSubjectTwice,
  indistinguishable,
].map(parseFixture);

export function listFixtures(): readonly FixtureFile[] {
  return FIXTURES;
}

export function getFixture(id: string): FixtureFile | undefined {
  return FIXTURES.find((fixture) => fixture.id === id);
}
