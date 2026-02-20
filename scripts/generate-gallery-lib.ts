import semverValid from "semver/functions/valid";
import semverRcompare from "semver/functions/rcompare";

import {
  Extension,
  ExtensionManifest,
  ExtensionVersion,
  GalleryConfig,
  GitHubRelease,
  ReleaseMetadata,
} from "./types";

/**
 * Parse a single GitHub release into an ExtensionVersion for the given
 * extension, or return null if the release doesn't match / is missing assets.
 */
export function parseExtensionRelease(
  release: GitHubRelease,
  extensionName: string,
  manifest: ExtensionManifest
): ExtensionVersion | null {
  if (!release.tagName.startsWith(`${extensionName}@v`)) return null;

  const version = release.tagName.split("@v")[1];
  const asset = release.assets.find((a) => a.name === `${extensionName}.tar.gz`);

  if (!asset) return null;

  let metadata: ReleaseMetadata | null = null;
  try {
    metadata = JSON.parse(release.body);
  } catch {
    // Old release without metadata — fall back to current manifest values
  }

  if (semverValid(version) === null) return null;

  const extVersion: ExtensionVersion = {
    version,
    released: release.publishedAt,
    url: asset.url,
    minimumConnectVersion:
      metadata?.minimumConnectVersion ||
      manifest.extension.minimumConnectVersion,
    ...(metadata?.requiredFeatures?.length
      ? { requiredFeatures: metadata.requiredFeatures }
      : manifest.extension.requiredFeatures?.length
        ? { requiredFeatures: manifest.extension.requiredFeatures }
        : {}),
    ...(metadata?.requiredEnvironment
      ? { requiredEnvironment: metadata.requiredEnvironment }
      : manifest.environment
        ? { requiredEnvironment: manifest.environment }
        : {}),
  };

  return extVersion;
}

/**
 * Build the Extension[] array from manifests and releases.
 */
export function buildExtensions(
  manifests: Map<string, ExtensionManifest>,
  releases: GitHubRelease[]
): Extension[] {
  const extensions: Extension[] = [];

  for (const [, manifest] of manifests) {
    const name = manifest.extension.name;

    // Skip extensions with version 0.0.0 (not yet released)
    if (manifest.extension.version === "0.0.0") continue;

    const extensionReleases = releases
      .map((r) => parseExtensionRelease(r, name, manifest))
      .filter((v): v is ExtensionVersion => v !== null)
      .sort((a, b) => semverRcompare(a.version, b.version));

    if (extensionReleases.length === 0) continue;

    extensions.push({
      name,
      title: manifest.extension.title,
      description: manifest.extension.description,
      homepage: manifest.extension.homepage,
      latestVersion: extensionReleases[0],
      versions: extensionReleases,
      tags: manifest.extension.tags || [],
      ...(manifest.extension.category
        ? { category: manifest.extension.category }
        : {}),
    });
  }

  extensions.sort((a, b) => a.name.localeCompare(b.name));
  return extensions;
}

/**
 * Collect all unique tags and features from a set of manifests.
 */
export function collectTagsAndFeatures(
  manifests: Map<string, ExtensionManifest>
): { allTags: Set<string>; allFeatures: Set<string> } {
  const allTags = new Set<string>();
  const allFeatures = new Set<string>();

  for (const [, manifest] of manifests) {
    for (const tag of manifest.extension.tags || []) {
      allTags.add(tag);
    }
    for (const feature of manifest.extension.requiredFeatures || []) {
      allFeatures.add(feature);
    }
  }

  return { allTags, allFeatures };
}

/**
 * Assemble the final output object.
 */
export function buildOutput(
  extensions: Extension[],
  config: GalleryConfig,
  allTags: Set<string>,
  allFeatures: Set<string>
) {
  return {
    categories: config.categories,
    tags: [...allTags].sort(),
    requiredFeatures: [...allFeatures].sort(),
    extensions,
  };
}
