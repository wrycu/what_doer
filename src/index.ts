import {Worker} from "@notionhq/workers";
import { Client } from "@notionhq/client";
import { j } from "@notionhq/workers/schema-builder";
import * as Schema from "@notionhq/workers/schema";
import * as Builder from "@notionhq/workers/builder";

import { parseMovieNameAndYear, tvdbGetMovieInfo } from "./movie";
import {find_game, get_game_details} from "./game";
import {getAuthToken, searchVideoGame} from "./videogame";
import { get_voice_users, get_discord_ids, update_attendance_status, ATTENDANCE_PAGE_ID } from "./user_sync";
import { getSteamLibrary, getStoreDetails, getGameCoverUrl, getGameIconUrl, minutesToHours, STEAM_BATCH_SIZE, SteamGame } from "./steam";

const worker = new Worker();
export default worker;

type TitleItem = {
	plain_text?: string;
	text?: { content?: string };
};
type NotionDbPageEventBody = {
	data: {
		properties: {
			Name: {
				title: TitleItem[];
			};
		};
	};
};

function isNotionDbPageEventBody(x: unknown): x is NotionDbPageEventBody {
	const nameTitle = (x as any)?.data?.properties?.Name?.title;
	return Array.isArray(nameTitle);
}

function getNameTitle(body: NotionDbPageEventBody): string | null {
	const first = body.data.properties.Name.title[0];
	return first?.plain_text ?? first?.text?.content ?? null;
}

// Example agent tool that returns a greeting
// Delete this when you're ready to start building your own tools.
worker.tool("sayHello", {
	title: "Say Hello",
	description: "Returns a friendly greeting for the given name.",
	schema: j.object({
		name: j.string().describe("The name to greet."),
	}),
	execute: ({ name }) => `Hello, ${name}!`,
});

worker.webhook("onIncomingData", {
	title: "Incoming Data Webhook",
	description: "Receives external data",
	execute: async (events, context) => {
		const notionToken = process.env.API_TOKEN;
		const tv_token = process.env.TVDB_API_TOKEN;
		const notion = new Client({auth: notionToken});
		for (const event of events) {
			//console.log(JSON.stringify(event.body, null, 2))
			const body = event.body; // local var helps TS narrow reliably

			if (!isNotionDbPageEventBody(body)) continue;

			const name = getNameTitle(body) || "";
			const page_id = (event.body.data as { id: string }).id;
			const movie_name = name;
			const parsed_data = parseMovieNameAndYear(movie_name);
			const parsed_name = parsed_data.movie;
			const parsed_year = parsed_data.year;
			const movie_details = await tvdbGetMovieInfo(tv_token ?? "", parsed_name, parsed_year);
			const runtime = movie_details.runtime;
			const movie_banner = movie_details.banner;
			const movie_icon = movie_details.icon;
			console.log("runtime", runtime)
			console.log(movie_banner, movie_icon)
			if (!runtime) {
				throw new Error("Unable to find movie runtime");
			}

			await notion.pages.update({
				page_id: page_id,
				properties: {
					Runtime: {
						number: runtime,
					},
				},
			});
			if (movie_banner) {
				await notion.pages.update({
					page_id: page_id,
					cover: {
						type: "external",
						external: {url: movie_banner}
					},
				});
			}
			if (movie_icon) {
				await notion.pages.update({
					page_id: page_id,
					icon: {
						type: "external",
						external: {url: movie_icon}
					},
				});
			}

		}
	}
});

worker.webhook("onIncomingBoardGame", {
	title: "Incoming Board Game Data Webhook",
	description: "Receives a board game edit event and pulls Board Game Geek data about it",
	execute: async (events, context) => {
		const notionToken = process.env.API_TOKEN;
		const bgg_token = process.env.BGG_API_TOKEN || "";
		const notion = new Client({auth: notionToken});
		for (const event of events) {
			//console.log(JSON.stringify(event.body, null, 2))
			const body = event.body; // local var helps TS narrow reliably

			if (!isNotionDbPageEventBody(body)) continue;

			const name = getNameTitle(body) || "";
			const page_id = (event.body.data as { id: string }).id;
			const game_name = name;

			const game_id = await find_game(bgg_token, game_name);
			if (!game_id) {
				throw new Error("Unable to find game ID");
			}
			console.log(game_id)
			const details = await get_game_details(bgg_token, game_id);
			console.log(details)
			if (!details) {
				throw new Error("Unable to locate game details!");
			}

			await notion.pages.update({
				page_id: page_id,
				properties: {
					"Min": {
					  	number: parseInt(details["players"]["min"]),
					},
					"Max": {
					  	number: parseInt(details["players"]["max"]),
					},
					"Rating": {
					  	number: parseFloat(parseFloat(details["rating"]).toFixed(2)),
					},
				},
			});
			if (details["image"]) {
				await notion.pages.update({
					page_id: page_id,
					cover: {
						type: "external",
						external: {url: details["image"]}
					},
				});
			}
		}
	}
});

// Schedule: Saturdays 10:00AM and 10:02AM Pacific
// Cron entries (add via `crontab -e`):
//   TZ=America/Los_Angeles
//   0 10 * * 6 ntn workers exec attendanceSync
//   2 10 * * 6 ntn workers exec attendanceSync
worker.tool("attendanceSync", {
	title: "Attendance Sync",
	description: "Checks who is in the Discord voice channel and marks them as present in Notion.",
	schema: j.object({}),
	execute: async (_input, { notion }) => {
		const [voice_users, discord_id_map] = await Promise.all([
			get_voice_users(),
			get_discord_ids(notion, ATTENDANCE_PAGE_ID),
		]);
		await update_attendance_status(notion, ATTENDANCE_PAGE_ID, voice_users, discord_id_map);
		return `Updated attendance for ${discord_id_map.size} users; ${voice_users.length} in voice.`;
	},
});

// Steam library sync
const steamGames = worker.database("steamGames", {
	type: "managed",
	initialTitle: "Steam Library",
	primaryKeyProperty: "App ID",
	schema: {
		properties: {
			Name: Schema.title(),
			"App ID": Schema.richText(),
			"Total Playtime (hrs)": Schema.number(),
			"Recent Playtime (hrs)": Schema.number(),
			"Last Played": Schema.date(),
			Genres: Schema.richText(),
			Metacritic: Schema.number(),
			"Release Date": Schema.date(),
			Cover: Schema.richText(),
			Icon: Schema.richText(),
		},
	},
});

const steamApi = worker.pacer("steamApi", { allowedRequests: 1, intervalMs: 1000 });
// Steam Store API: unauthenticated, informal limit ~200 req/5min; 1 req/1.5s stays comfortably under.
const steamStore = worker.pacer("steamStore", { allowedRequests: 1, intervalMs: 1500 });

type SteamSyncState = { offset: number };

worker.sync("steamLibrarySync", {
	database: steamGames,
	mode: "replace",
	schedule: "1d",
	execute: async (state: SteamSyncState | null | undefined) => {
		const offset = state?.offset ?? 0;

		await steamApi.wait();
		const apiKey = process.env.STEAM_API_KEY ?? "";
		const steamId = process.env.STEAM_ID ?? "";
		const games = await getSteamLibrary(apiKey, steamId);

		const batch = games.slice(offset, offset + STEAM_BATCH_SIZE);
		const hasMore = offset + STEAM_BATCH_SIZE < games.length;

		const changes = [];
		for (const game of batch) {
			await steamStore.wait();
			const store = await getStoreDetails(game.appid);
			// Steam uses 86400 (Jan 2 1970) as a sentinel for "played before tracking existed"
			const lastPlayedDate = game.rtime_last_played > 86400
				? new Date(game.rtime_last_played * 1000).toISOString().split("T")[0]
				: null;
			changes.push({
				type: "upsert" as const,
				key: String(game.appid),
				properties: {
					Name: Builder.title(game.name),
					"App ID": Builder.richText(String(game.appid)),
					"Total Playtime (hrs)": Builder.number(minutesToHours(game.playtime_forever)),
					"Recent Playtime (hrs)": Builder.number(minutesToHours(game.playtime_2weeks ?? 0)),
					...(lastPlayedDate ? { "Last Played": Builder.date(lastPlayedDate) } : {}),
					...(store.genres.length ? { Genres: Builder.richText(store.genres.join(", ")) } : {}),
					...(store.metacritic !== null ? { Metacritic: Builder.number(store.metacritic) } : {}),
					...(store.releaseDate ? { "Release Date": Builder.date(store.releaseDate) } : {}),
					Cover: Builder.richText(getGameCoverUrl(game.appid)),
					...(game.img_icon_url ? { Icon: Builder.richText(getGameIconUrl(game.appid, game.img_icon_url)) } : {}),
				},
			});
		}

		return {
			changes,
			hasMore,
			nextState: hasMore ? { offset: offset + STEAM_BATCH_SIZE } : undefined,
		};
	},
});

worker.webhook("onIncomingVideoGame", {
	title: "Incoming Video Game Data Webhook",
	description: "Receives a video game edit event and pulls IGDB data about it",
	execute: async (events, context) => {
		const notionToken = process.env.API_TOKEN;
		const igdb_token = process.env.IGDB_TOKEN || "";
		const notion = new Client({auth: notionToken});
		for (const event of events) {
			//console.log(JSON.stringify(event.body, null, 2))
			const body = event.body; // local var helps TS narrow reliably

			if (!isNotionDbPageEventBody(body)) continue;

			const name = getNameTitle(body) || "";
			const page_id = (event.body.data as { id: string }).id;
			const game_name = name;
			const auth_token = await getAuthToken(igdb_token);

			const details = await searchVideoGame(auth_token, game_name);
			console.log(details);
			if (!details) {
				throw new Error("Unable to locate game details!");
			}

			if (details["icon"]) {
				await notion.pages.update({
					page_id: page_id,
					icon: {
						type: "external",
						external: {url: details["icon"]}
					},
				});
			}
			if (details["cover"]) {
				await notion.pages.update({
					page_id: page_id,
					cover: {
						type: "external",
						external: {url: details["cover"]}
					},
				});
			}
		}
	}
});
