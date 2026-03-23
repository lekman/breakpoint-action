import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
import { getModeFromInput } from "./lib";

const defaultBreakpointVersion = "0.0.24";

function getBreakpointVersion(): string {
	const override = process.env.BREAKPOINT_VERSION?.trim().replace(/^v/, "");
	if (override) {
		core.info(`Using breakpoint version from BREAKPOINT_VERSION: ${override}`);
		return override;
	}
	return defaultBreakpointVersion;
}

interface WaitConfig {
	endpoint: string;
	duration: string;
	authorized_keys?: string[];
	shell?: string[];
	allowed_ssh_users: string[];
	webhooks?: Webhook[];
	slack_bot?: SlackBot;
}

class Webhook {
	url: string;
	payload: unknown;
}

class SlackBot {
	channel: string;
	token: string;
}

async function run(): Promise<void> {
	try {
		await installBreakpoint();
		await runBreakpoint();
	} catch (err) {
		core.setFailed(err.message);
	}
}

async function installBreakpoint(): Promise<void> {
	// Download the specific version of the tool, e.g. as a tarball.
	const toolURL = await getDownloadURL();
	core.info(`Downloading: ${toolURL}`);

	const pathToTarball = await tc.downloadTool(toolURL, null, null, {
		CI: process.env.CI,
		"User-Agent": "breakpoint-action",
		accept: "application/octet-stream",
	});

	// Extract the tarball onto the runner.
	const pathToCLI = await tc.extractTar(pathToTarball);

	// Expose the tool by adding it to the $PATH.
	core.addPath(pathToCLI);
}

async function runBreakpoint(): Promise<void> {
	const configFile = tmpFile("config.json");
	const config = await createConfiguration();

	const mode = getModeFromInput();

	core.debug(`Mode: ${mode}`);

	if (mode === "background") {
		core.info("Duration input is ignored when running in background mode");
		config.duration = "10h";
	}

	core.debug(`Configuration: ${config}`);

	fs.writeFile(configFile, JSON.stringify(config), (err) => {
		if (err) {
			core.setFailed(`Failed to write config file: ${err.message}`);
			return;
		}
	});

	core.debug(new Date().toTimeString());
	if (mode === "pause") {
		await exec.exec(`breakpoint wait --config=${configFile}`);
	} else {
		await exec.exec(`breakpoint start --config=${configFile}`);
	}
	core.debug(new Date().toTimeString());
}

async function getDownloadURL(): Promise<string> {
	const { RUNNER_ARCH, RUNNER_OS } = process.env;

	let arch = "";
	switch (RUNNER_ARCH) {
		case "X64":
			arch = "amd64";
			break;
		case "ARM64":
			arch = "arm64";
			break;
		default:
			throw new Error(`Unsupported architecture: ${RUNNER_ARCH}`);
	}

	let os = "";
	switch (RUNNER_OS) {
		case "macOS":
			os = "darwin";
			break;
		case "Linux":
			os = "linux";
			break;
		case "Windows":
			os = "windows";
			break;
		default:
			throw new Error(`Unsupported operating system: ${RUNNER_OS}`);
	}

	const version = getBreakpointVersion();
	return `https://github.com/namespacelabs/breakpoint/releases/download/v${version}/breakpoint_${os}_${arch}.tar.gz`;
}

// Fetch SSH public keys for a GitHub user via the API.
// Uses the REST API (/users/<login>/keys) which works for EMU accounts,
// unlike the public github.com/<login>.keys endpoint which returns 404 for
// usernames containing underscores or belonging to EMU orgs.
async function fetchGitHubUserKeys(username: string): Promise<string[]> {
	const url = `https://api.github.com/users/${encodeURIComponent(username)}/keys`;
	core.debug(`Fetching SSH keys for ${username} from ${url}`);

	return new Promise((resolve, reject) => {
		https.get(url, { headers: { "User-Agent": "breakpoint-action" } }, (res) => {
			if (res.statusCode !== 200) {
				reject(new Error(
					`Failed to fetch SSH keys for GitHub user "${username}": ` +
					`HTTP ${res.statusCode} from ${url}`
				));
				return;
			}

			let data = "";
			res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
			res.on("end", () => {
				try {
					const keys = JSON.parse(data) as Array<{ key: string }>;
					const publicKeys = keys.map((k) => k.key);
					core.info(`Fetched ${publicKeys.length} SSH key(s) for ${username}`);
					resolve(publicKeys);
				} catch (err) {
					reject(new Error(`Failed to parse SSH keys response for "${username}": ${err}`));
				}
			});
		}).on("error", (err) => {
			reject(new Error(`Network error fetching SSH keys for "${username}": ${err.message}`));
		});
	});
}

async function createConfiguration(): Promise<WaitConfig> {
	const config: WaitConfig = {
		endpoint: core.getInput("endpoint"),
		duration: core.getInput("duration"),
		allowed_ssh_users: ["runner"],
	};

	const collectedKeys: string[] = [];
	const resolvedUsers = new Set<string>();

	// Auto-include the workflow actor (PR author / manual trigger user)
	const includeActor = core.getInput("include-actor") !== "false";
	if (includeActor) {
		const actor = process.env.GITHUB_ACTOR;
		if (actor && !actor.endsWith("[bot]")) {
			resolvedUsers.add(actor);
			core.info(`Auto-included workflow actor: ${actor}`);
		} else if (actor) {
			core.debug(`Skipped bot actor: ${actor}`);
		}
	}

	const authorizedUsers: string = core.getInput("authorized-users");
	if (authorizedUsers) {
		for (const u of authorizedUsers.split(",")) {
			resolvedUsers.add(String(u).trim());
		}
	}

	for (const username of resolvedUsers) {
		const keys = await fetchGitHubUserKeys(username);
		if (keys.length === 0) {
			core.warning(`No SSH keys found for GitHub user "${username}"`);
		}
		collectedKeys.push(...keys);
	}

	const authorizedKeys: string = core.getInput("authorized-keys");
	if (authorizedKeys) {
		collectedKeys.push(...authorizedKeys.split(",").map((k) => String(k).trim()));
	}

	if (collectedKeys.length === 0) {
		throw new Error(
			"No SSH keys found. Provide 'authorized-users' (with SSH keys on their GitHub profile) " +
			"or 'authorized-keys' directly."
		);
	}

	config.authorized_keys = collectedKeys;
	core.info(`Authorized ${collectedKeys.length} SSH key(s) total`);

	const webhookDefFile: string = core.getInput("webhook-definition");
	if (webhookDefFile) {
		const webhookDef: string = fs.readFileSync(webhookDefFile, "utf8");
		config.webhooks = [JSON.parse(webhookDef)];
	}

	const shell: string = core.getInput("shell");
	if (shell) {
		config.shell = [shell];
	} else if (process.env.RUNNER_OS === "Windows") {
		config.shell = ["c:\\windows\\system32\\cmd.exe"];
	}

	const slackChannel: string = core.getInput("slack-announce-channel");
	if (slackChannel) {
		const slackBot: SlackBot = {
			channel: slackChannel,
			token: "${SLACK_BOT_TOKEN}",
		};
		config.slack_bot = slackBot;
	}

	return config;
}

function tmpFile(file: string): string {
	const tmpDir = path.join(process.env.RUNNER_TEMP, "breakpoint");
	if (!fs.existsSync(tmpDir)) {
		fs.mkdirSync(tmpDir);
	}

	return path.join(tmpDir, file);
}

run();
