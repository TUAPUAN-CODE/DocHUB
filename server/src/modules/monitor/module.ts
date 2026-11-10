import router from './routes';
import { startTrafficFlush, trafficMeter } from './traffic';

/** Admin Monitor page: requests through the Cloudflare tunnel / LAN, per minute, hour, day and month */
export default { router, trafficMeter, startTrafficFlush };
