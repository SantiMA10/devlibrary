/**
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";
import ogs from "open-graph-scraper";
import { URL } from "url";

import {
  normalizeAuthorId,
  addGithubAuthor,
  addMediumAuthor,
  getMediumPostAuthor,
  authorExists,
} from "./addauthor";
import { writeOrUpdateJSON, getConfigDir } from "./util";

/**
 * @returns {Promise<string>} the project ID
 */
export async function addOtherBlog(
  product: string,
  projectUrl: string,
  projectId?: string,
  overrides?: object
): Promise<string> {
  const templateStr = fs
    .readFileSync(path.join(getConfigDir(), "template-blog.json"))
    .toString();
  const blogFileContent = JSON.parse(templateStr);
  blogFileContent.source = "other";
  blogFileContent.link = projectUrl;

  Object.assign(blogFileContent, overrides || {});

  // Get the title from OpenGraph
  const { result } = await ogs({
    url: projectUrl,
  });
  if (result.success) {
    blogFileContent.title = result.ogTitle;
  }

  // Make a slug ID from the URL
  const u = new URL(projectUrl);
  const segments = u.pathname
    .split("/")
    .map((s) => s.split(".")[0])
    .filter((s) => s.length > 0);
  const slug = segments.join("-");

  const blogId = projectId || slug;
  const blogFilePath = path.join(
    getConfigDir(),
    product,
    "blogs",
    `${blogId}.json`
  );
  writeOrUpdateJSON(blogFilePath, blogFileContent);

  return blogId;
}

function parseMediumUrl(projectUrl: string) {
  // Types of medium URL
  // 1) https://medium.com/user/post-slug-12345abcde
  // 2) https://user.medium.com/post-slug-12345abcde
  const mainRe = /medium\.com\/([\w\-\@\.]+)\/([\w\-]+)/;
  const mainMatch = projectUrl.match(mainRe);
  if (mainMatch) {
    return {
      author: mainMatch[1],
      slug: mainMatch[2],
    };
  }

  const subdomainRe = /([\w\-\@\.]+)\.medium\.com\/([\w\-]+)/;
  const subdomainMatch = projectUrl.match(subdomainRe);
  if (subdomainMatch) {
    return {
      author: subdomainMatch[1],
      slug: subdomainMatch[2],
    };
  }

  return {};
}

/**
 * @returns {Promise<string>} the project ID
 */
export async function addMediumBlog(
  product: string,
  projectUrl: string,
  projectId?: string,
  overrides?: object
): Promise<string> {
  const { slug } = parseMediumUrl(projectUrl);

  const templateStr = fs
    .readFileSync(path.join(getConfigDir(), "template-blog.json"))
    .toString();
  const blogFileContent = JSON.parse(templateStr);
  blogFileContent.link = projectUrl;

  Object.assign(blogFileContent, overrides || {});

  // Add the author
  // TODO: This doesn't work for proandroiodev, etc
  const postAuthor = await getMediumPostAuthor(projectUrl);
  if (postAuthor) {
    if (!authorExists(postAuthor)) {
      await addMediumAuthor(postAuthor);
    }
  }
  blogFileContent.authorIds = postAuthor ? [normalizeAuthorId(postAuthor)] : [];

  const blogId = projectId || slug;
  if (!blogId) {
    throw new Error(`Could not parse Medium URL: ${projectUrl}`);
  }

  const blogFilePath = path.join(
    getConfigDir(),
    product,
    "blogs",
    `${blogId}.json`
  );
  writeOrUpdateJSON(blogFilePath, blogFileContent);

  return blogId;
}

async function getRepoReadme(owner: string, repo: string) {
  // If available, use a GitHub token from the environment
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    {
      method: "get",
      headers,
    }
  );
  const { path } = await res.json();

  return path;
}

/**
 * @returns {Promise<string>} the project ID
 */
export async function addRepo(
  product: string,
  projectUrl: string,
  projectId?: string,
  overrides?: object
): Promise<string> {
  const re = /github.com\/([\w\-]+)\/([\w\-]+)/;
  const m = projectUrl.match(re);

  if (!m) {
    throw new Error(`Invalid GitHub URL: ${projectUrl}`);
  }

  const owner = m[1];
  const repo = m[2];

  const templateStr = fs
    .readFileSync(path.join(getConfigDir(), "template-repo.json"))
    .toString();
  const repoFileContent = JSON.parse(templateStr);
  repoFileContent.owner = owner;
  repoFileContent.repo = repo;

  Object.assign(repoFileContent, overrides || {});

  // Check if we have a matching author aready
  if (!authorExists(owner)) {
    await addGithubAuthor(owner);
  }

  // We check again to see if we skipped the author or not
  if (authorExists(owner)) {
    repoFileContent.authorIds = [normalizeAuthorId(owner)];
  } else {
    repoFileContent.authorIds = [];
  }

  // Get the name of the README file
  const readmePath = await getRepoReadme(owner, repo);
  repoFileContent.content = readmePath;

  const repoId = projectId || `${owner}-${repo}`;
  const repoFilePath = path.join(
    getConfigDir(),
    product,
    "repos",
    `${repoId}.json`
  );
  writeOrUpdateJSON(repoFilePath, repoFileContent);

  return repoId;
}

export async function main(args: string[]) {
  if (args.length < 4) {
    console.error(
      "Missing required arguments:\nnpm run addproject <product> <url> [id]"
    );
    return;
  }

  const product = args[2];
  const projectUrl = args[3];
  const projectId = args.length >= 5 ? args[4] : undefined;

  console.log(`Product: ${product}`);
  console.log(`Project: ${projectUrl}`);

  if (projectUrl.includes("github.com")) {
    await addRepo(product, projectUrl, projectId);
  } else if (projectUrl.includes("medium.com")) {
    await addMediumBlog(product, projectUrl, projectId);
  } else {
    await addOtherBlog(product, projectUrl, projectId);
  }
}

if (require.main === module) {
  main(process.argv);
}
