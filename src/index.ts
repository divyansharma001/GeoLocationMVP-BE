import app from './app';
import { scheduleMonthlyReset } from './jobs/monthlyReset';
import { scheduleDailyBirthdays } from './jobs/dailyBirthday';
import { startNudgeCronJobs } from './jobs/checkNudges';
import { startInterestReportJob } from './jobs/sendInterestEmail';
import http from 'http';
import { setupWebSocket } from './lib/websocket/socket.server';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
  if (process.env.DISABLE_SCHEDULER !== 'true') {
    scheduleMonthlyReset();
    scheduleDailyBirthdays();
    startNudgeCronJobs();
    startInterestReportJob();
    console.log('[scheduler]: Monthly reset scheduled.');
    console.log('[scheduler]: Daily birthdays scheduled.');
    console.log('[scheduler]: Nudge jobs scheduled.');
    console.log('[scheduler]: Interest report job scheduled.');
  }
});