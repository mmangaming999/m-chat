# m-chat desktop

## Run on your PC

1. Extract `m-chat-desktop.zip`.
2. Open the extracted `m-chat` folder in VS Code and open a terminal.
3. With Node.js 24 installed, run:

   ```powershell
   node server.js
   ```

4. Open [http://localhost:3001](http://localhost:3001) in your browser.

The app uses built-in Node.js modules. Keep the terminal open while you use it. If port 3001 is busy, run `$env:PORT = "3002"; node server.js` and open http://localhost:3002 instead.

## Update an existing copy

Stop the server with Ctrl+C. Extract the ZIP into the parent of your current `m-chat` folder and replace the application files when prompted. Keep your existing `m-chat/data` folder, which contains your accounts and chats. Start the server again with `node server.js`.

Home now has shortcuts for adding friends, browsing servers, and creating groups. After you send or receive a message, **Recent chats** gives you a quick way back to that conversation.

## Test with two accounts

1. Sign up normally, then sign up again in a private window or another browser.
2. Use **You** to see or change each account’s username. Each account starts with a unique username such as `@user_1`.
3. Open **Friends & chats** in the first account, send a request to the second username, and accept it in the second account.
4. Click **Message** next to the friend to open a DM. Both accounts can send messages.

Use **Friends & chats** to create a private group or join a public server. From **Settings**, group members can add accepted friends or invite them. Group owners and managers can allow earlier messages for people joining in the future. Server owners and moderators can manage channels, kick members, and ban or unban them.

To change a group or server logo, click the pencil in the chat header. To edit your profile or change its picture, click **You** or your picture on Home. The picture and logo editors accept a photo or a 16×16 drawing.

## Data and scope

`data/chat.sqlite` holds the accounts, sessions, chats, and images. Keep the `data` folder to preserve them across restarts. Recent messages load when you open a conversation and new messages appear on a roughly one-second refresh.

This is the PC build. The custom ringtone and online hosting are still pending. The metallic-blue M is the temporary mark from the approved mockup.

## Emoji and GIF picker

- Click the smile icon to open the categorized emoji grid. Scroll for more or search by name. Click an emoji to insert it at the current cursor position.
- Click **GIF** to browse the bundled animated reactions. Select one to attach it, then click **Send**. The starter GIFs work offline.
- To enable live GIPHY searches on your PC, get your own client API key from the [GIPHY developer dashboard](https://developers.giphy.com/dashboard/). Download a white-on-dark **Powered By GIPHY** PNG from the [official attribution pack](https://media.giphy.com/giphy-attribution-marks.zip) and save it as `public/giphy-attribution.png`. In PowerShell, run:

  ```powershell
  $env:GIPHY_API_KEY = "your-client-api-key"
  node server.js
  ```

  GIPHY searches and GIF playback contact GIPHY directly from the browser and use its G rating. The client API key is visible to signed-in users of this instance. The database stores the selected GIF ID.


## Voice calls

Open a DM or private group and click the handset in the header. Allow microphone access when your browser asks. Other chat members can join from the incoming call prompt, or from the handset in that chat while the call is active. The call panel shows a light-blue outline when it detects someone speaking. The default ringtone is a two-note chime. Click or tap the app once after signing in so your browser can play incoming call sounds.

For a first test, use your regular and InPrivate browser windows on the same PC and wear headphones. Both windows should be open at `http://localhost:3001`. The call uses direct WebRTC audio. This build does not include a relay for networks that block direct connections. Browsers need localhost or HTTPS for microphone access.


## Share your screen

1. Join a voice call and click the screen-share icon.
2. Choose 480p, 720p, or 1080p, and 30 fps or 60 fps. Start with 720p at 30 fps, or try 720p at 60 fps for gameplay with fast motion. These are capture targets. The browser and connection can deliver lower quality.
3. Select a screen, window, or browser tab from your browser’s picker. The viewer has a fullscreen button. If multiple people share, use the screen selector in the viewer.

Click the lit screen-share icon, use your browser’s **Stop sharing** control, or hang up to stop capture. Screen sharing sends video. Voice still comes from the call microphone. If you’re testing on one PC, share a window other than m-chat to avoid a mirrored preview.


## Turn on your webcam

In a DM or private group call, click the camera icon and allow access if your browser asks. Cameras start off. Each person’s video appears in their tile, and you can share a screen at the same time. Camera capture targets up to 720p at 30 fps. Click the camera icon again or hang up to stop using the webcam.

For a two-account test on one PC, start with one camera active. Some webcams can only be opened by one browser window at a time.
