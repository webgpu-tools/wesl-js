import { beforeEach } from "vitest";
import { resetScopeIds } from "../Scope.ts";

// Auto-reset scope IDs before each test for consistent output
beforeEach(() => {
  resetScopeIds();
});
