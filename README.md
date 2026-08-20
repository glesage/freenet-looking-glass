# Looking Glass

Want to see what data is stored on your computer? This dashboard lets you inspect data on your Freenet node (contract state). Built mostly to get a better grasp of how different contracts store data and learn about Freenet myself (:

<img width="1111" height="927" alt="lg" src="https://github.com/user-attachments/assets/3d664356-cab8-4b7a-93f2-0e361d72667b" />

## Develop

Requires a local Freenet node (default ws-api `127.0.0.1:7509`).

```bash
make dev        # vite dev server → http://127.0.0.1:5173/?node=127.0.0.1:7509
make test       # unit tests + live-node e2e
make update     # push updates to freenet
```

## Known limits

The contract search functionality in Looking Glass uses some arbitrary attributes of contract state that are set for River, Delta and some other base apps, but they may not work for every app. When no discernible field is readable, the contract description in the search UI will simply be "Unknown"
<img width="472" height="248" alt="Screenshot 2026-08-21 at 12 00 30 am" src="https://github.com/user-attachments/assets/18dd2ce5-b341-4c70-bd02-bab12fa925d9" />
Finding contract keys is a bit tough when there are dedicated contracts within an app. In order to find you'll have to either click every contract one at a time in the search list, or ask AI (:
