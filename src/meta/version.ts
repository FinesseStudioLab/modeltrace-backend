import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// src/meta/version.ts compiles to dist/meta/version.js, two levels below
// the repo root where package.json lives.
const packageJsonPath = join(here, "..", "..", "package.json");

interface PackageJson {
  name: string;
  version: string;
}

let cachedPackageJson: PackageJson | undefined;

function readPackageJson(): PackageJson {
  if (!cachedPackageJson) {
    cachedPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson;
  }
  return cachedPackageJson;
}

export interface MetaInfo {
  name: string;
  version: string;
  description: string;
  build: {
    /** Commit SHA the running instance was built from. "unknown" outside CI. */
    commit: string;
    /** ISO timestamp of the build. "unknown" outside CI. */
    builtAt: string;
  };
  network: {
    stellarNetwork: string;
    sorobanRpcUrl: string;
    contracts: {
      auditRegistry: string;
      usageMeter: string;
      paymentRouter: string;
    };
  };
}

export interface MetaConfig {
  stellar: {
    network: string;
    sorobanRpcUrl: string;
    contracts: {
      auditRegistry: string;
      usageMeter: string;
      paymentRouter: string;
    };
  };
}

/**
 * Builds the /meta response. Version comes from package.json rather than a
 * literal so it can't drift. Commit SHA and build time come from
 * environment variables — the container this runs in has no .git
 * directory, so they must be injected at build/deploy time (e.g. a CI step
 * exporting BUILD_SHA=${{ github.sha }}), not read via `git rev-parse` at
 * runtime.
 */
export function getMetaInfo(config: MetaConfig, env: NodeJS.ProcessEnv = process.env): MetaInfo {
  const pkg = readPackageJson();
  return {
    name: pkg.name,
    version: pkg.version,
    description: "REST facade for Soroban contracts and indexers.",
    build: {
      commit: env.BUILD_SHA ?? "unknown",
      builtAt: env.BUILD_TIME ?? "unknown",
    },
    network: {
      stellarNetwork: config.stellar.network,
      sorobanRpcUrl: config.stellar.sorobanRpcUrl,
      contracts: {
        auditRegistry: config.stellar.contracts.auditRegistry,
        usageMeter: config.stellar.contracts.usageMeter,
        paymentRouter: config.stellar.contracts.paymentRouter,
      },
    },
  };
}
