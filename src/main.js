import { App } from './app/app.js';

async function bootstrap() {
    console.log(`using LJM version ${window.JitsiMeetJS?.version}!`);

    const app = new App();
    await app.init();
}

document.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch(error => {
        console.error('Failed to start application', error);
    });
});
