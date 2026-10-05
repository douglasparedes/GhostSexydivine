import cron from 'node-cron';
import { config } from './config.js';
import { runAudit, listAudits } from './audit.js';
import * as ghost from './ghost.js';
import * as gemini from './gemini.js';

export function startScheduler() {
  if (!config.auditCron) {
    console.log('Scheduler disabled (AUDIT_CRON empty)');
    return;
  }
  if (!cron.validate(config.auditCron)) {
    console.log(`Scheduler disabled (invalid AUDIT_CRON "${config.auditCron}")`);
    return;
  }
  cron.schedule(config.auditCron, async () => {
    if (!ghost.isConfigured()) {
      console.log('Scheduled audit skipped: Ghost is not configured');
      return;
    }
    try {
      console.log('Starting scheduled audit of all posts and pages');
      const job = await runAudit({
        kind: 'all',
        target: 'scheduled',
        withAi: gemini.isConfigured(),
      });
      console.log(`Scheduled audit finished: ${job.status}`);
    } catch (error) {
      console.log(`Scheduled audit failed: ${error.message}`);
    }
    if (config.draftWatch) {
      try {
        console.log('Starting scheduled draft watch');
        const job = await runAudit({
          kind: 'drafts',
          target: 'scheduled-drafts',
          withAi: gemini.isConfigured(),
        });
        console.log(`Scheduled draft watch finished: ${job.status}`);
      } catch (error) {
        console.log(`Scheduled draft watch failed: ${error.message}`);
      }
    }
  });
  console.log(`Scheduler enabled (${config.auditCron})`);
}

export { listAudits };
