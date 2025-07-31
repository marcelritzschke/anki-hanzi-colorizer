import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import fs from "fs/promises";

const toneColorMap: Record<number, string> = {
  1: "tone1", // Red for tone 1
  2: "tone2", // Green for tone 2
  3: "tone3", // Blue for tone 3
  4: "tone4", // Yellow for tone 4
  5: "tone5", // - for tone 5 (neutral tone)
};

type AnkiResponse<T> = {
  result: T;
  error: string | null;
};

export async function invoke<T = any>(action: string, params = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 300)); // wait 300ms between requests
  try {
    const response = await axios.post<AnkiResponse<T>>(
      "http://127.0.0.1:8765",
      {
        action,
        version: 6,
        params,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept-Encoding": "identity", // 🔧 disable compression
          Connection: "close", // 🔧 avoid persistent socket issues
        },
        decompress: false, // optional: prevents auto gzip decode
      }
    );

    if (response.data.error) throw new Error(response.data.error);
    return response.data.result;
  } catch (err: any) {
    throw new Error(`invoke failed: ${err.message}`);
  }
}

function colorCode(html: string): string {
  const $ = cheerio.load(html);
  // const strongBlock = $("strong.color-coding");
  // const spans = strongBlock.find("span");
  $("div.color-coding span").each((_, span) => {
    var pinyin = require("chinese-to-pinyin");
    const tone = parseInt(
      pinyin($(span).html(), { toneToNumberOnly: true }),
      10
    );

    const colorClass = toneColorMap[tone] || "tone5"; // Default to empty if tone is invalid
    $(span).attr("class", colorClass); // Set the class to the tone color
  });

  const updatedHTML = $.html();
  // console.log(updatedHTML);

  return updatedHTML;
}

async function colorize() {
  const ids = await invoke<number[]>("findNotes", {
    query: "deck:Chinese is:new",
  });
  console.log("Found note IDs:", ids);

  const timestamp = new Date().toISOString().replace(/[:.-]/g, "_");
  const backupFile = path.join(__dirname, `anki-backup_${timestamp}.json`);
  const backup: any[] = [];

  for (const id of ids) {
    try {
      console.log(`Requesting note ${id}...`);
      const result = await invoke<any[]>("notesInfo", { notes: [id] });
      // console.log(`Success:`, result[0]);

      const backHtml = result[0].fields.Back.value;
      backup.push({
        noteId: id,
        fields: {
          Back: backHtml,
        },
      });
      await fs.writeFile(backupFile, JSON.stringify(backup, null, 2));

      const updatedHtml = colorCode(backHtml);

      // ✅ Update Anki note
      await invoke("updateNoteFields", {
        note: {
          id,
          fields: {
            Back: updatedHtml,
          },
        },
      });

      console.log(`✅ Updated note ${id}`);
    } catch (e) {
      console.error(`❌ Failed on note ${id}:`, e);
    }
  }

  console.log(`🛡️ Backup written to ${backupFile}`);
}

colorize().catch(console.error);
