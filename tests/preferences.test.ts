import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gamePreferencesSchema,parseJvmArgs} from '../src/launcher/preferences.js';
import {gameLaunchOptions} from '../src/launcher/game.js';

test('JVM arguments preserve quoted values and reject broken or conflicting launch options',()=>{
 assert.deepEqual(parseJvmArgs('-XX:MaxGCPauseMillis=100 -Dlabel="hello world"'),['-XX:MaxGCPauseMillis=100','-Dlabel=hello world']);
 for(const value of ['-Xmx8G','-Xms4G','-jar other.jar','@args.txt','-Dtest="unclosed'])assert.throws(()=>parseJvmArgs(value));
 assert.deepEqual(parseJvmArgs(''),[]);
});
test('window settings and JVM options reach the actual game launcher',()=>{
 const preferences=gamePreferencesSchema.parse({width:1600,height:900,fullscreen:true,autoJoin:false,jvmArgs:'-XX:MaxGCPauseMillis=100'});
 const options=gameLaunchOptions('instance',{version:'1.21.1',javaPath:'java',resourcePath:'minecraft'},{nickname:'Player',uuid:'1234'},undefined,{},6,preferences);
 assert.deepEqual(options.resolution,{width:1600,height:900,fullscreen:true});
 assert.deepEqual(options.extraJVMArgs,['-XX:+UseG1GC','-XX:MaxGCPauseMillis=100']);
 assert.equal(options.maxMemory,6144);assert.equal(options.quickPlayMultiplayer,undefined);
 assert.throws(()=>gamePreferencesSchema.parse({width:0}));
});
