# Price Tracker

A Chrome extension that tracks product prices from Amazon, Flipkart, Reliance Digital, Croma and more — right in your browser sidebar. Desktop notifications on price changes. No backend required.

<table>
  <tr>
    <td><img src="screenshots/sidebar.png" width="320" alt="Sidebar"/></td>
    <td><img src="screenshots/edit-modal.png" width="320" alt="Edit item"/></td>
    <td><img src="screenshots/settings.png" width="320" alt="Settings"/></td>
  </tr>
</table>

## Features

- Amazon, Flipkart, Reliance Digital, Croma, Myntra, Meesho + any site with JSON-LD / Open Graph price data
- Chrome Side Panel — live price table always visible alongside your tabs
- Desktop notifications on price drops/increases with a "View Product" button
- Price history per item (up to 60 entries)
- Edit item name or URL without re-adding
- Scheduled checks via `chrome.alarms` — works even when the sidebar is closed
- 100% client-side — all data in `chrome.storage.local`

## Installation

> Requires Chrome 114+

1. Download **`price-tracker-vX.X.X.zip`** from the [Releases page](https://github.com/AviroopPaul/price-tracker/releases/latest)
2. Unzip it
3. Go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder
4. Click the extension icon in the toolbar to open the side panel

## Settings

Accessible via the gear icon in the sidebar. Configure check interval (1h–48h), notification toggles for increases/decreases, and a minimum % threshold to suppress small fluctuations.

## License

MIT
