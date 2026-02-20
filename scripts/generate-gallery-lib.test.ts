import { describe, it, expect } from "vitest";

import {
  ExtensionManifest,
  GitHubApiRelease,
  GitHubRelease,
  GalleryConfig,
} from "./types";
import {
  parseExtensionRelease,
  buildExtensions,
  collectTagsAndFeatures,
  buildOutput,
  transformGitHubApiReleases,
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

// ---------------------------------------------------------------------------
// transformGitHubApiReleases
// ---------------------------------------------------------------------------

describe("transformGitHubApiReleases", () => {
  it("maps snake_case API fields to camelCase GitHubRelease", () => {
    const apiReleases: GitHubApiRelease[] = [
      {
        tag_name: "my-ext@v1.0.0",
        published_at: "2024-06-01T00:00:00Z",
        assets: [
          { name: "my-ext.tar.gz", browser_download_url: "https://example.com/my-ext.tar.gz" },
        ],
        body: "release notes",
      },
    ];

    const result = transformGitHubApiReleases(apiReleases);

    expect(result).toEqual([
      {
        tagName: "my-ext@v1.0.0",
        publishedAt: "2024-06-01T00:00:00Z",
        assets: [{ name: "my-ext.tar.gz", url: "https://example.com/my-ext.tar.gz" }],
        body: "release notes",
      },
    ]);
  });

  it("maps browser_download_url to url on assets", () => {
    const apiReleases: GitHubApiRelease[] = [
      {
        tag_name: "ext@v2.0.0",
        published_at: "2025-01-01T00:00:00Z",
        assets: [
          { name: "ext.tar.gz", browser_download_url: "https://github.com/download/ext.tar.gz" },
          { name: "ext.zip", browser_download_url: "https://github.com/download/ext.zip" },
        ],
        body: "",
      },
    ];

    const result = transformGitHubApiReleases(apiReleases);

    expect(result[0].assets).toEqual([
      { name: "ext.tar.gz", url: "https://github.com/download/ext.tar.gz" },
      { name: "ext.zip", url: "https://github.com/download/ext.zip" },
    ]);
  });

  it("handles releases with no assets", () => {
    const apiReleases: GitHubApiRelease[] = [
      {
        tag_name: "ext@v1.0.0",
        published_at: "2024-06-01T00:00:00Z",
        assets: [],
        body: "",
      },
    ];

    const result = transformGitHubApiReleases(apiReleases);

    expect(result[0].assets).toEqual([]);
  });

  it("handles empty body", () => {
    const apiReleases: GitHubApiRelease[] = [
      {
        tag_name: "ext@v1.0.0",
        published_at: "2024-06-01T00:00:00Z",
        assets: [],
        body: "",
      },
    ];

    const result = transformGitHubApiReleases(apiReleases);

    expect(result[0].body).toBe("");
  });

  it("transforms multiple releases", () => {
    const apiReleases: GitHubApiRelease[] = [
      {
        tag_name: "ext@v2.0.0",
        published_at: "2025-01-01T00:00:00Z",
        assets: [{ name: "ext.tar.gz", browser_download_url: "https://example.com/v2.tar.gz" }],
        body: "v2",
      },
      {
        tag_name: "ext@v1.0.0",
        published_at: "2024-06-01T00:00:00Z",
        assets: [{ name: "ext.tar.gz", browser_download_url: "https://example.com/v1.tar.gz" }],
        body: "v1",
      },
    ];

    const result = transformGitHubApiReleases(apiReleases);

    expect(result).toHaveLength(2);
    expect(result[0].tagName).toBe("ext@v2.0.0");
    expect(result[1].tagName).toBe("ext@v1.0.0");
  });

  it("produces output compatible with parseExtensionRelease", () => {
    const apiReleases: GitHubApiRelease[] = [
      {
        tag_name: "my-ext@v1.0.0",
        published_at: "2024-06-01T00:00:00Z",
        assets: [
          { name: "my-ext.tar.gz", browser_download_url: "https://example.com/my-ext.tar.gz" },
        ],
        body: JSON.stringify({ minimumConnectVersion: "2025.01.0" }),
      },
    ];

    const releases = transformGitHubApiReleases(apiReleases);
    const manifest = makeManifest();
    const version = parseExtensionRelease(releases[0], "my-ext", manifest);

    expect(version).not.toBeNull();
    expect(version!.version).toBe("1.0.0");
    expect(version!.url).toBe("https://example.com/my-ext.tar.gz");
    expect(version!.minimumConnectVersion).toBe("2025.01.0");
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
