import path from "node:path"
import { env } from "process"

import {
  getInput,
  setFailed,
  setOutput,
  summary
} from "@actions/core"
import { context, getOctokit } from "@actions/github"
import type { Deployment, Project } from "@cloudflare/types"
import { default as shellac } from "shellac"
import { fetch } from "undici"

type Octokit = ReturnType<typeof getOctokit>

try {
  const apiToken = getInput("apiToken", { required: true })
  const accountId = getInput("accountId", { required: true })
  const projectName = getInput("projectName", { required: true })
  const directory = getInput("directory", { required: true })
  const gitHubToken = getInput("gitHubToken", { required: false })
  const branch = getInput("branch", { required: false })
  const workingDirectory = getInput("workingDirectory", {
    required: false
  })

  const getProject = async () => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )

    if (response.status !== 200) {
      console.error(
        `Cloudflare API returned non-200: ${response.status}`
      )
      const json = await response.text()

      console.error(`API returned: ${json}`)
      throw new Error(
        "Failed to get Pages project, API returned non-200"
      )
    }

    const { result } = (await response.json()) as {
      result: Project | null
    }

    if (result === null) {
      throw new Error(
        "Failed to get Pages project, project does not exist. Check the project name or create it!"
      )
    }

    return result
  }

  const createPagesDeployment = async () => {
    // TODO: Replace this with an API call to wrangler so we can get back a full deployment response object
    await shellac.in(path.join(process.cwd(), workingDirectory))`
    $ export CLOUDFLARE_API_TOKEN="${apiToken}"
    if ${accountId} {
      $ export CLOUDFLARE_ACCOUNT_ID="${accountId}"
    }

    $$ wrangler pages deploy "${directory}" --project-name="${projectName}" --branch="${branch}"
    `

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )
    const {
      result: [deployment]
    } = (await response.json()) as { result: Deployment[] }

    return deployment
  }

  const githubBranch =
    env["GITHUB_HEAD_REF"] ?? env["GITHUB_REF_NAME"]

  const createGitHubDeployment = async (
    octokit: Octokit,
    productionEnvironment: boolean,
    environment: string
  ) => {
    const deployment = await octokit.rest.repos.createDeployment({
      auto_merge: false,
      description: "Cloudflare Pages",
      environment,
      owner: context.repo.owner,
      production_environment: productionEnvironment,
      ref: githubBranch ?? context.ref,
      repo: context.repo.repo,
      required_contexts: []
    })

    if (deployment.status === 201) {
      return deployment.data
    }
  }

  const createGitHubDeploymentStatus = async ({
    deploymentId,
    environmentName,
    id,
    octokit,
    productionEnvironment,
    url
  }: {
    deploymentId: string
    environmentName: string
    id: number
    octokit: Octokit
    productionEnvironment: boolean
    url: string
  }) => {
    await octokit.rest.repos.createDeploymentStatus({
      auto_inactive: false,
      deployment_id: id,
      description: "Cloudflare Pages",
      environment: environmentName,
      environment_url: url,
      log_url: `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}/${deploymentId}`,
      owner: context.repo.owner,
      production_environment: productionEnvironment,
      repo: context.repo.repo,
      state: "success"
    })
  }

  const createJobSummary = async ({
    aliasUrl,
    deployment
  }: {
    aliasUrl: string
    deployment: Deployment
  }) => {
    const deployStage = deployment.stages.find(
      (stage) => stage.name === "deploy"
    )

    let status = "⚡️  Deployment in progress..."

    if (deployStage?.status === "success") {
      status = "✅  Deploy successful!"
    } else if (deployStage?.status === "failure") {
      status = "🚫  Deployment failed"
    }

    await summary
      .addRaw(
        `
# Deploying with Cloudflare Pages

| Name                    | Result |
| ----------------------- | - |
| **Last commit:**        | \`${deployment.deployment_trigger.metadata.commit_hash.substring(0, 8)}\` |
| **Status**:             | ${status} |
| **Preview URL**:        | ${deployment.url} |
| **Branch Preview URL**: | ${aliasUrl} |
      `
      )
      .write()
  }

  ;(async () => {
    const project = await getProject()

    const productionEnvironment =
      githubBranch === project.production_branch ||
      branch === project.production_branch
    const environmentName = `${projectName} (${productionEnvironment ? "Production" : "Preview"})`

    let gitHubDeployment: Awaited<
      ReturnType<typeof createGitHubDeployment>
    >

    if (gitHubToken.length) {
      const octokit = getOctokit(gitHubToken)

      gitHubDeployment = await createGitHubDeployment(
        octokit,
        productionEnvironment,
        environmentName
      )
    }

    const pagesDeployment = await createPagesDeployment()

    setOutput("id", pagesDeployment?.id)
    setOutput("url", pagesDeployment?.url)
    setOutput("environment", pagesDeployment?.environment)

    let alias = pagesDeployment?.url

    if (
      !productionEnvironment &&
      pagesDeployment?.aliases &&
      pagesDeployment.aliases.length > 0
    ) {
      alias = pagesDeployment.aliases[0]
    }
    setOutput("alias", alias)

    await createJobSummary({
      aliasUrl: alias,
      deployment: pagesDeployment
    })

    if (gitHubDeployment) {
      const octokit = getOctokit(gitHubToken)

      await createGitHubDeploymentStatus({
        deploymentId: pagesDeployment?.id,
        environmentName,
        id: gitHubDeployment.id,
        octokit,
        productionEnvironment,
        url: pagesDeployment?.url
      })
    }
  })()
} catch (thrown) {
  setFailed(thrown.message)
}
