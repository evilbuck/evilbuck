# Project Overview

This project is a personal portfolio website for Buckley Robinson, a Staff Full-Stack Engineer. It is built using the [Astro](https://astro.build/) framework and styled with [Tailwind CSS](https://tailwindcss.com/).

The website's main purpose is to showcase Buckley's resume, work experience, and projects. The content for the resume is dynamically generated from a combination of a TypeScript data file (`src/data/resume.ts`) and a Markdown file (`src/pages/resume.md`).

## Building and Running

The project uses `npm` for package management. The key commands are defined in the `scripts` section of the `package.json` file.

*   **Development:** To start the development server, run:
    ```bash
    npm run dev
    ```

*   **Building:** To build the project for production, run:
    ```bash
    npm run build
    ```

*   **Preview:** To preview the production build locally, run:
    ```bash
    npm run preview
    ```

## Development Conventions

*   **Component-Based Architecture:** The website is built using Astro's component-based architecture. Components are located in the `src/components` directory.
*   **Data Separation:** The resume data is separated from the presentation layer. Structured data is stored in `src/data/resume.ts`, and the main content is in `src/pages/resume.md`.
*   **Styling:** Styling is done using a combination of global CSS in `src/layouts/Layout.astro` and Tailwind CSS utility classes.
*   **Pages:** The website has two main pages: the home page (`/`) which displays the resume, and the projects page (`/projects`).
