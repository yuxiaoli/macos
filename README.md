# macOS Web Experience

A fully functional macOS Monterey-style desktop environment running entirely in the browser. This project simulates the look and feel of macOS using standard HTML, CSS, and JavaScript (jQuery).

🔗 **Live Demo:** [https://yuxiaoli.github.io/macos/](https://yuxiaoli.github.io/macos/)

![macOS Web Screenshot](https://raw.githubusercontent.com/yuxiaoli/macos/gh-pages/screenshot.png)
*(Note: You might want to add a screenshot later)*

## 🚀 Features

-   **Desktop Environment:** Authentic boot sequence, dynamic wallpaper, and responsive layout.
-   **Window Management:** Draggable, resizable, minimizable, and maximizable windows with z-index layering.
-   **Dock & Menu Bar:** Interactive dock with bounce animations and a functional top menu bar.
-   **Included Apps:**
    -   **Finder:** Navigate a simulated file system (Desktop, Documents, Downloads).
    -   **Safari:** Functional web browser (iframe-based) with `vectorindex.io` as the default homepage.
    -   **Terminal:** Interactive command-line interface with commands like `ls`, `date`, `echo`, and a `matrix` visual effect.
    -   **TextEdit:** Rich text editor simulation.
    -   **Sketch:** A fully functional drawing/paint application.
    -   **Calculator:** Working standard calculator.
    -   **Studio:** Video editor simulation with real-time CSS filters.
    -   **Settings:** Change desktop wallpapers.

## 🛠️ Tech Stack

-   **Frontend:** HTML5, CSS3, JavaScript (ES6+)
-   **Libraries:** jQuery, jQuery UI (for draggable/resizable interactions), FontAwesome (icons)
-   **Runtime (Local Dev):** [Bun](https://bun.sh/)

## 🏃‍♂️ Local Development

To run this project locally, ensure you have [Bun](https://bun.sh/) installed.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yuxiaoli/macos.git
    cd macos
    ```

2.  **Install dependencies:**
    ```bash
    cd site
    bun install
    ```

3.  **Start the local server:**
    ```bash
    bun run server.ts
    ```

4.  **Open in Browser:**
    Visit `http://localhost:3000`

## 📦 Deployment

The project is configured to deploy to **GitHub Pages**.

### Manual Deployment
A convenience script is provided for Windows users:

```bash
.\scripts\deploy.bat
```

This script will:
1.  Push changes to the `develop` branch.
2.  Push the `site` folder to the `gh-pages` branch.

## 📂 Project Structure

```
macos/
├── site/               # Main website source code
│   ├── index.html      # Single-file application
│   ├── server.ts       # Local Bun server
│   └── ...
├── scripts/            # Utility scripts
│   └── deploy.bat      # Deployment script
├── src/                # Original source references
└── README.md           # Project documentation
```

## 📄 License

This project is open source. Based on an original concept from CodePen.
