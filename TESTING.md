# Testing Instructions

Follow these steps to test the ElevenLabs Translator extension on the real site.

## 1. Load the Extension
1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (toggle in the top right).
3.  Click **Load unpacked**.
4.  Select the directory: `/Users/ajanderson/GitHub/chrome_plugins/ff_poc_elevenlabs_flowreader`.
    -   *Note: If you have already loaded it, click the **Reload** (circular arrow) icon on the extension card.*

## 2. Configure API Key
1.  Click the **Extensions** (puzzle piece) icon in the Chrome toolbar.
2.  Click **ElevenLabs Translator**.
3.  In the popup:
    -   Enter your **OpenAI API Key** (starts with `sk-...`).
    -   Click **Save Key**.
    -   Verify the message "API Key Saved!" appears.

## 3. Test on ElevenLabs Reader
1.  Navigate to an ElevenLabs Reader page, for example:
    -   [Demo Article](https://elevenreader.io/reader/library/u:gQMZ8hyfjs0tHXC1JVlO)
2.  Wait for the page to load. You should see the blue **"文"** floating button in the bottom right corner.
3.  **Press and Hold** the button.
    -   *First time:* It may take 1-3 seconds for the API request to complete.
    -   *Observation:* You should see translation overlays appear above the text clauses.
4.  **Release** the button to hide the translations.

## Troubleshooting
-   **No Button?** Refresh the page. Ensure the extension is enabled.
-   **No Translations?**
    -   Open the **Developer Tools** (Right-click > Inspect).
    -   Check the **Console** tab for errors (e.g., "Translation failed").
    -   Check the **Network** tab to see if the request to `api.openai.com` was blocked or failed.
-   **API Error?** Ensure your API key has credit/quota and is valid.
