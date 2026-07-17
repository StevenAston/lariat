import readline from 'readline';
import { config } from './config';
import { log } from './logger';

let queue: Promise<any> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(() => task());
  queue = result.catch(() => {});
  return result;
}

export async function requestApproval(actionName: string, details: string): Promise<void> {
  if (!config.interactiveMode) {
    return;
  }

  return enqueue(async () => {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log(`\n=========================================`);
      console.log(`[Requires Approval] ${actionName}`);
      console.log(`Details: ${details}`);
      
      const ask = () => {
        rl.question(`Allow this action? (y/n): `, (answer) => {
          const lower = answer.trim().toLowerCase();
          if (lower === 'y' || lower === 'yes') {
            rl.close();
            log.info('Approval', `User approved action: ${actionName}`);
            resolve();
          } else if (lower === 'n' || lower === 'no') {
            rl.close();
            log.warn('Approval', `User rejected action: ${actionName}`);
            reject(new Error(`User rejected action: ${actionName}`));
          } else {
            console.log('Please answer y or n.');
            ask();
          }
        });
      };
      
      ask();
    });
  });
}
