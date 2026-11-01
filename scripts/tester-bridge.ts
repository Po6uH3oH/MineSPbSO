import { createTesterBridge } from '../src/service/tester-bridge.js';
const bridge=await createTesterBridge('.local/tester-keys','.local/tester-distribution');
bridge.listen(3443,'10.99.52.8',()=>console.log('MineSPbSO · https://10.99.52.8:3443 · Ctrl+C для остановки'));

