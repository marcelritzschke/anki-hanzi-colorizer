import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import fs from "fs/promises";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";
import "dotenv/config";

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

function stripHtml(html: string): string {
  const $ = cheerio.load(html);
  return $.root().text();
}

async function tts() {
  const ids = await invoke<number[]>("findNotes", {
    query: "deck:Chinese is:new",
  });
  console.log("Found note IDs:", ids);

  for (const id of ids) {
    try {
      console.log(`Requesting note ${id}...`);
      const result = await invoke<any[]>("notesInfo", { notes: [id] });

      const frontHtml = result[0].fields.Front.value;
      const frontText = stripHtml(frontHtml);

      if (/\[sound:.*\.mp3\]/.test(frontHtml)) {
        console.log(`⏭️ Note ${id} already has audio. Skipping.`);
        continue;
      }

      if (frontText.length > 24) {
        console.log(
          `⏭️ Front text too long (${frontText.length} characters) for note ${id}. Skipping.`
        );
        continue;
      }

      const audioFileName = `note_${id}.mp3`;
      const audioPath = path.join(__dirname, audioFileName);

      // 🚩 Check if audio file already exists
      try {
        await fs.access(audioPath);
      } catch {
        // ✅ Generate TTS audio
        console.log(`Generating audio for note ${id}...`);

        const elevenlabs = new ElevenLabsClient();
        const audio = await elevenlabs.textToSpeech.convert(
          "MI36FIkp9wRP7cpWKPTl",
          {
            text: frontText,
            languageCode: "zh",
            modelId: "eleven_turbo_v2_5",
            outputFormat: "mp3_44100_128",
            voiceSettings: {
              speed: 0.9,
            },
          }
        );

        // ✅ Save audio to file
        await fs.writeFile(audioPath, audio);
        console.log(`Audio saved to ${audioPath}`);
      }

      // ✅ Store audio in Anki media folder
      const audioBuffer = await fs.readFile(audioPath);
      const audioBase64 = audioBuffer.toString("base64");
      await invoke("storeMediaFile", {
        filename: audioFileName,
        data: audioBase64,
      });

      // ✅ Update Anki note
      const updatedHtml = `${result[0].fields.Front.value}<br>[sound:${audioFileName}]`;
      await invoke("updateNoteFields", {
        note: {
          id,
          fields: {
            Front: updatedHtml,
          },
        },
      });
      console.log(`✅ Updated note ${id} with audio`);
    } catch (e) {
      console.error(`❌ Failed on note ${id}:`, e);
    }
  }
}

tts().catch(console.error);
