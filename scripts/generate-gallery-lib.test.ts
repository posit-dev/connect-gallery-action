import { describe, it, expect } from "vitest";

import {
  ExtensionManifest,
  GitHubRelease,
  GalleryConfig,
} from "./types";
import {
  parseExtensionRelease,
  buildExtensions,
  collectTagsAndFeatures,
  buildOutput,
} from "./generate-gallery-lib";

// ---------------------------------------------------------------------------
// Helpers to build test fixtures
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<ExtensionManifest["extension"]> = {}): ExtensionManifest {
  return {
    extension: {
      name: "my-ext",
      title: "My Extension",
      description: "A test extension",
      homepage: "https://example.com",
      version: "1.0.0",
      minimumConnectVersion: "2024.01.0",
      tags: [],
      ...overrides,
    },
  };
}

function makeRelease(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tagName: "my-ext@v1.0.0",
    publishedAt: "2024-06-01T00:00:00Z",
    assets: [{ name: "my-ext.tar.gz", url: "https://example.com/my-ext.tar.gz" }],
    body: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseExtensionRelease
// ---------------------------------------------------------------------------

describe("parseExtensionRelease", () => {
  it("parses a valid release", () => {
    const manifest = makeManifest();
    const release = makeRelease();

    const result = parseExtensionRelease(release, "my-ext", manifest);

    expect(result).toEqual({
      version: "1.0.0",
      released: "2024-06-01T00:00:00Z",
      url: "https://example.com/my-ext.tar.gz",
      minimumConnectVersion: "2024.01.0",
    });
  });

  it("returns null when tag does not match extension name", () => {
    const manifest = makeManifest();
    const release = makeRelease({ tagName: "other-ext@v1.0.0" });

    expect(parseExtensionRelease(release, "my-ext", manifest)).toBeNull();
  });

  it("returns null when asset is missing", () => {
    const manifest = makeManifest();
    const release = makeRelease({ assets: [] });

    expect(parseExtensionRelease(release, "my-ext", manifest)).toBeNull();
  });

  it("returns null for invalid semver version", () => {
    const manifest = makeManifest();
    const release = makeRelease({ tagName: "my-ext@vnot-a-version" });

    expect(parseExtensionRelease(release, "my-ext", manifest)).toBeNull();
  });

  it("uses metadata from release body when available", () => {
    const manifest = makeManifest({ minimumConnectVersion: "2024.01.0" });
    const release = makeRelease({
      body: JSON.stringify({
        minimumConnectVersion: "2025.01.0",
        requiredFeatures: ["feature-a"],
        requiredEnvironment: { python: { requires: ">=3.10" } },
      }),
    });

    const result = parseExtensionRelease(release, "my-ext", manifest);

    expect(result).not.toBeNull();
    expect(result!.minimumConnectVersion).toBe("2025.01.0");
    expect(result!.requiredFeatures).toEqual(["feature-a"]);
    expect(result!.requiredEnvironment).toEqual({ python: { requires: ">=3.10" } });
  });

  it("falls back to manifest values when release body is not JSON", () => {
    const manifest = makeManifest({
      minimumConnectVersion: "2024.01.0",
      requiredFeatures: ["manifest-feature"],
    });
    // Also add environment to manifest
    const fullManifest: ExtensionManifest = {
      ...manifest,
      environment: { python: { requires: ">=3.9" } },
    };
    const release = makeRelease({ body: "just some release notes" });

    const result = parseExtensionRelease(release, "my-ext", fullManifest);

    expect(result).not.toBeNull();
    expect(result!.minimumConnectVersion).toBe("2024.01.0");
    expect(result!.requiredFeatures).toEqual(["manifest-feature"]);
    expect(result!.requiredEnvironment).toEqual({ python: { requires: ">=3.9" } });
  });

  it("omits requiredFeatures when neither metadata nor manifest has them", () => {
    const manifest = makeManifest({ requiredFeatures: undefined });
    const release = makeRelease();

    const result = parseExtensionRelease(release, "my-ext", manifest);

    expect(result).not.toBeNull();
    expect(result!.requiredFeatures).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildExtensions
// ---------------------------------------------------------------------------

describe("buildExtensions", () => {
  it("builds extensions from manifests and releases", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("my-ext", makeManifest());

    const releases: GitHubRelease[] = [
      makeRelease({ tagName: "my-ext@v1.0.0", publishedAt: "2024-06-01T00:00:00Z" }),
      makeRelease({ tagName: "my-ext@v0.9.0", publishedAt: "2024-05-01T00:00:00Z",
        assets: [{ name: "my-ext.tar.gz", url: "https://example.com/my-ext-0.9.tar.gz" }],
      }),
    ];

    const result = buildExtensions(manifests, releases);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-ext");
    expect(result[0].versions).toHaveLength(2);
    // Sorted descending by semver
    expect(result[0].versions[0].version).toBe("1.0.0");
    expect(result[0].versions[1].version).toBe("0.9.0");
    expect(result[0].latestVersion.version).toBe("1.0.0");
  });

  it("skips extensions with version 0.0.0", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("unreleased", makeManifest({ name: "unreleased", version: "0.0.0" }));

    const releases: GitHubRelease[] = [
      makeRelease({ tagName: "unreleased@v0.0.1",
        assets: [{ name: "unreleased.tar.gz", url: "https://example.com/unreleased.tar.gz" }],
      }),
    ];

    const result = buildExtensions(manifests, releases);
    expect(result).toHaveLength(0);
  });

  it("skips extensions with no matching releases", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("no-releases", makeManifest({ name: "no-releases" }));

    const result = buildExtensions(manifests, []);
    expect(result).toHaveLength(0);
  });

  it("sorts extensions alphabetically by name", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("zebra", makeManifest({ name: "zebra" }));
    manifests.set("alpha", makeManifest({ name: "alpha" }));

    const releases: GitHubRelease[] = [
      makeRelease({
        tagName: "zebra@v1.0.0",
        assets: [{ name: "zebra.tar.gz", url: "https://example.com/zebra.tar.gz" }],
      }),
      makeRelease({
        tagName: "alpha@v1.0.0",
        assets: [{ name: "alpha.tar.gz", url: "https://example.com/alpha.tar.gz" }],
      }),
    ];

    const result = buildExtensions(manifests, releases);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("alpha");
    expect(result[1].name).toBe("zebra");
  });

  it("includes category when present in manifest", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("cat-ext", makeManifest({ name: "cat-ext", category: "data-science" }));

    const releases: GitHubRelease[] = [
      makeRelease({
        tagName: "cat-ext@v1.0.0",
        assets: [{ name: "cat-ext.tar.gz", url: "https://example.com/cat-ext.tar.gz" }],
      }),
    ];

    const result = buildExtensions(manifests, releases);
    expect(result[0].category).toBe("data-science");
  });

  it("omits category when not present in manifest", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("no-cat", makeManifest({ name: "no-cat", category: undefined }));

    const releases: GitHubRelease[] = [
      makeRelease({
        tagName: "no-cat@v1.0.0",
        assets: [{ name: "no-cat.tar.gz", url: "https://example.com/no-cat.tar.gz" }],
      }),
    ];

    const result = buildExtensions(manifests, releases);
    expect(result[0].category).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectTagsAndFeatures
// ---------------------------------------------------------------------------

describe("collectTagsAndFeatures", () => {
  it("collects unique tags and features from all manifests", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("a", makeManifest({ tags: ["python", "data"], requiredFeatures: ["gpu"] }));
    manifests.set("b", makeManifest({ tags: ["python", "ml"], requiredFeatures: ["gpu", "cuda"] }));

    const { allTags, allFeatures } = collectTagsAndFeatures(manifests);

    expect([...allTags].sort()).toEqual(["data", "ml", "python"]);
    expect([...allFeatures].sort()).toEqual(["cuda", "gpu"]);
  });

  it("handles manifests with no tags or features", () => {
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("a", makeManifest({ tags: undefined, requiredFeatures: undefined }));

    const { allTags, allFeatures } = collectTagsAndFeatures(manifests);

    expect(allTags.size).toBe(0);
    expect(allFeatures.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildOutput
// ---------------------------------------------------------------------------

describe("buildOutput", () => {
  it("assembles the correct output shape", () => {
    const config: GalleryConfig = {
      categories: [
        { id: "data-science", title: "Data Science", description: "DS extensions" },
      ],
    };
    const manifests = new Map<string, ExtensionManifest>();
    manifests.set("ext", makeManifest({ tags: ["z-tag", "a-tag"], requiredFeatures: ["z-feat", "a-feat"] }));

    const releases: GitHubRelease[] = [makeRelease()];
    const extensions = buildExtensions(
      new Map([["ext", makeManifest()]]),
      releases
    );
    const tags = new Set(["z-tag", "a-tag"]);
    const features = new Set(["z-feat", "a-feat"]);

    const output = buildOutput(extensions, config, tags, features);

    expect(output.categories).toEqual(config.categories);
    expect(output.tags).toEqual(["a-tag", "z-tag"]);
    expect(output.requiredFeatures).toEqual(["a-feat", "z-feat"]);
    expect(output.extensions).toEqual(extensions);
  });
});
