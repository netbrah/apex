/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GitIgnoreFilter } from '../utils/gitIgnoreParser.js';
import type { ApexIgnoreFilter } from '../utils/apexIgnoreParser.js';
import { GitIgnoreParser } from '../utils/gitIgnoreParser.js';
import { ApexIgnoreParser } from '../utils/apexIgnoreParser.js';
import { isGitRepository } from '../utils/gitUtils.js';
import * as path from 'node:path';

export interface FilterFilesOptions {
  respectGitIgnore?: boolean;
  respectApexIgnore?: boolean;
}

export interface FilterReport {
  filteredPaths: string[];
  gitIgnoredCount: number;
  apexIgnoredCount: number;
}

export class FileDiscoveryService {
  private gitIgnoreFilter: GitIgnoreFilter | null = null;
  private apexIgnoreFilter: ApexIgnoreFilter | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    if (isGitRepository(this.projectRoot)) {
      this.gitIgnoreFilter = new GitIgnoreParser(this.projectRoot);
    }
    this.apexIgnoreFilter = new ApexIgnoreParser(this.projectRoot);
  }

  /**
   * Filters a list of file paths based on git ignore rules
   */
  filterFiles(
    filePaths: string[],
    options: FilterFilesOptions = {
      respectGitIgnore: true,
      respectApexIgnore: true,
    },
  ): string[] {
    return filePaths.filter((filePath) => {
      if (options.respectGitIgnore && this.shouldGitIgnoreFile(filePath)) {
        return false;
      }
      if (options.respectApexIgnore && this.shouldApexIgnoreFile(filePath)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Filters a list of file paths based on git ignore rules and returns a report
   * with counts of ignored files.
   */
  filterFilesWithReport(
    filePaths: string[],
    opts: FilterFilesOptions = {
      respectGitIgnore: true,
      respectApexIgnore: true,
    },
  ): FilterReport {
    const filteredPaths: string[] = [];
    let gitIgnoredCount = 0;
    let apexIgnoredCount = 0;

    for (const filePath of filePaths) {
      if (opts.respectGitIgnore && this.shouldGitIgnoreFile(filePath)) {
        gitIgnoredCount++;
        continue;
      }

      if (opts.respectApexIgnore && this.shouldApexIgnoreFile(filePath)) {
        apexIgnoredCount++;
        continue;
      }

      filteredPaths.push(filePath);
    }

    return {
      filteredPaths,
      gitIgnoredCount,
      apexIgnoredCount,
    };
  }

  /**
   * Checks if a single file should be git-ignored
   */
  shouldGitIgnoreFile(filePath: string): boolean {
    if (this.gitIgnoreFilter) {
      return this.gitIgnoreFilter.isIgnored(filePath);
    }
    return false;
  }

  /**
   * Checks if a single file should be apex-ignored
   */
  shouldApexIgnoreFile(filePath: string): boolean {
    if (this.apexIgnoreFilter) {
      return this.apexIgnoreFilter.isIgnored(filePath);
    }
    return false;
  }

  /**
   * Unified method to check if a file should be ignored based on filtering options
   */
  shouldIgnoreFile(
    filePath: string,
    options: FilterFilesOptions = {},
  ): boolean {
    const {
      respectGitIgnore = true,
      respectApexIgnore: respectApexIgnore = true,
    } = options;

    if (respectGitIgnore && this.shouldGitIgnoreFile(filePath)) {
      return true;
    }
    if (respectApexIgnore && this.shouldApexIgnoreFile(filePath)) {
      return true;
    }
    return false;
  }

  /**
   * Returns loaded patterns from .apexignore
   */
  getApexIgnorePatterns(): string[] {
    return this.apexIgnoreFilter?.getPatterns() ?? [];
  }
}
