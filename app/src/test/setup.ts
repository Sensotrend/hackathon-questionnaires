import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy* waits for rendering that fetches and parses the questionnaires.
configure({ asyncUtilTimeout: 5_000 });

afterEach(cleanup);
