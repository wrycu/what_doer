import { Client, GatewayIntentBits } from "discord.js";
import { Client as NotionClient } from "@notionhq/client";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";

export const ATTENDANCE_PAGE_ID = "31c01d15-8dca-8054-8c5a-eb131bbb6efb";

export const USER_MAP: Array<{ discordIdProp: string; hereProp: string }> = [
	{ discordIdProp: "Ben Discord ID",    hereProp: "Ben Here"    },
	{ discordIdProp: "Jeremy Discord ID", hereProp: "Jeremy Here" },
	{ discordIdProp: "Navit Discord ID",  hereProp: "Navit Here"  },
	{ discordIdProp: "Tad Discord ID",    hereProp: "Tad Here"    },
	{ discordIdProp: "Tim Discord ID",    hereProp: "Tim Here"    },
];

function buildChannelMap(guild: any) {
	// channelId -> array of userIds
	const map = new Map();

	for (const [, vs] of guild.voiceStates.cache) {
		if (!vs.channelId) continue;
		if (!map.has(vs.channelId)) map.set(vs.channelId, []);
		map.get(vs.channelId).push(vs.id);
	}

	return map;
}

export async function get_voice_users(): Promise<string[]> {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
		],
	});

	return new Promise((resolve, reject) => {
		client.once("ready", async () => {
			if (!client?.user) {
				client.destroy();
				return reject(new Error("Unable to log in"));
			}
			console.log(`Logged in as ${client.user.tag}`);

			try {
				const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

				// Ensure caches are populated. voiceStates are generally ready by now,
				// but waiting one tick helps in practice.
				await new Promise((r) => setTimeout(r, 500));

				const map = buildChannelMap(guild);
				const allUsers: string[] = [];

				for (const [channelId, userIds] of map) {
					console.log(`Channel ${channelId}: ${userIds.join(", ")}`);
					allUsers.push(...userIds);
				}

				resolve(allUsers);
			} catch (e) {
				reject(e);
			} finally {
				client.destroy();
			}
		});

		client.login(DISCORD_BOT_TOKEN);
	});
}

// Returns a map of Discord user ID -> "Here" property name
export async function get_discord_ids(notion_client: NotionClient, page_id: string): Promise<Map<string, string>> {
	const page = await notion_client.pages.retrieve({ page_id }) as any;
	const result = new Map<string, string>();

	for (const { discordIdProp, hereProp } of USER_MAP) {
		const property = page.properties[discordIdProp];
		if (!property || property.type !== "rich_text") continue;
		const id = property.rich_text.map((block: any) => block.plain_text).join("");
		if (id) result.set(id, hereProp);
	}

	return result;
}

export async function update_attendance_status(
	notion_client: NotionClient,
	page_id: string,
	users_here: string[],
	discord_id_map: Map<string, string>,
) {
	const properties: Record<string, { checkbox: boolean }> = {};

	for (const [discordId, hereProp] of discord_id_map) {
		console.log(discordId, users_here.includes(discordId));
		properties[hereProp] = { checkbox: users_here.includes(discordId) };
	}

	await notion_client.pages.update({ page_id, properties });
}
