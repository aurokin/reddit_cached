import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { RootLayout } from "@/pages/RootLayout";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./render";

const originalFetch = globalThis.fetch;

function mockApi(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("RootLayout navigation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("renders desktop nav links for all sections", async () => {
    mockApi();
    renderWithProviders(<RootLayout>content</RootLayout>);

    await waitFor(() => expect(screen.getByTestId("nav-home")).toBeTruthy());
    expect(screen.getByTestId("nav-browse")).toBeTruthy();
    expect(screen.getByTestId("nav-links")).toBeTruthy();
    expect(screen.getByTestId("nav-inbox")).toBeTruthy();
    expect(screen.getByTestId("nav-settings")).toBeTruthy();
  });

  test("renders the mobile hamburger trigger", async () => {
    mockApi();
    renderWithProviders(<RootLayout>content</RootLayout>);

    await waitFor(() => expect(screen.getByTestId("nav-mobile")).toBeTruthy());
    // Hidden on md+ via class only; the element itself must exist for mobile.
    expect(screen.getByTestId("nav-mobile").className).toContain("md:hidden");
  });
});
