import {Worker} from "@notionhq/workers";
import { Client } from "@notionhq/client";
import { j } from "@notionhq/workers/schema-builder";

import { parseMovieNameAndYear, tvdbGetMovieInfo } from "./movie";
import {find_game, get_game_details} from "./game";

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
