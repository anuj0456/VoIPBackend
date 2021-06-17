app.run(['$window','$rootScope','$websocket','$location','$timeout','$log','$http','$q',
function($window,$rootScope,$websocket,$location,$timeout,$log,$http,$q){

var_utils={
httpBaseUrl:function($location){
return$location.protocol()+'://'+$location.host()+":"+$location.port()+'/MobilityServices/AirportTalk';
},
wsBaseUrl:function($location){
varwsProtocol=($location.protocol()==='https'?'wss':'ws');
returnwsProtocol+'://'+$location.host()+":"+$location.port()+'/MobilityWebsocket/AirportTalk/airport/';
},
pttUrl:function($location){
varpttProtocol=($location.protocol()==='https'?'wss':'ws');
returnpttProtocol+'://'+$location.host()+":"+$location.port()+'/MobilityWebsocket/AirportTalk/ptt';
}
};

varwsStatus={
initial:'initial',
connected:'connected',
closed:'closed',
error:'error'
};

varsipStatus={
initial:'initial',
started:'started',
connected:'connected',
failed:'failed'
};

$rootScope.messaging={};
varvm=$rootScope.messaging;
vm.totalUnseenCount=0;
vm.wsConnectionUuid=AT.StringUtils.uuid();
vm.ws=undefined;
vm.usedSessionToken=null;
vm.wsStatus=wsStatus.initial;

vm.sipStack=null;
vm.sipRegisterSession=null;
vm.sipCallSession=null;
vm.sipConfig={};
vm.sipStatus=sipStatus.initial;
vm.sipCallReady=false;
vm.sipInCall=false;

$rootScope.$on('evt_contextChanged',function(event,msg){
_contextChanged();
});

function_contextChanged(){
_init();
}

function_init(){
_updateWebsocketStatus();
			//stopsipconnection
/*_updateSIPConnection();*/
if(AT.SessionUtils.hasData()){
_loadChats().then(function(result){
$timeout(function(){
vm.totalUnseenCount=result.data.totalUnseenCount;
});
});
}

_initBrowserNotification();
}

/*WEBSOCKET*/
function_updateWebsocketStatus(){
var_sessionData=_loadSessionData();
if(_isActive()){

if(vm.usedSessionToken&&vm.usedSessionToken!==_sessionData.userSessionToken){
//wasconnectingwithadifferenttoken,disposethatoneandreconnect
_forceCloseWS();
}

if(vm.ws){
return;
}
try{
vm.usedSessionToken=_sessionData.userSessionToken;

$log.info('renewingwebsocketconnection...');
vm.ws=$websocket(_utils.wsBaseUrl($location)
+_sessionData.customerCode+'?'
+'X-AT-userSessionToken='+encodeURIComponent(_sessionData.userSessionToken)
+'&X-AT-mac='+encodeURIComponent(_sessionData.mac)
+'&X-AT-connectionUuid='+vm.wsConnectionUuid);

vm.ws.onOpen(function(e){
_wsStatus(wsStatus.connected);
});
vm.ws.onClose(function(e){
$log.debug('websocketclosed');
$log.warn(e);
_wsStatus(wsStatus.closed);
if(vm.ws){
//closedbyexternalmodule,retry
_tryReconnectWebsocket();
}//else:closedbyus
});
vm.ws.onError(function(e){
$log.debug('websocketerror');
$log.error(e);
_wsStatus(wsStatus.error);
});
vm.ws.onMessage(function(msgEvt){
varmsg=JSON.parse(msgEvt.data);
if(msg.payloadType==='CHAT'||msg.payloadType==='SIGNAL'){
if(msg.payloadType==='CHAT'){
if(msg.sender.uid!=_currentUid()){
vm.totalUnseenCount++;
}
}
$rootScope.$broadcast("evt_chat_onMessage",msg);
}elseif(msg.payloadType==='SYSTEM'&&msg.eventName==='CHECKLIST_UPDATED'){
//achecklisthasbeenupdated,broadcastthis
$rootScope.$broadcast('evt_sys_postedChecklistUpdated',msg);
}elseif(msg.payloadType==='SYSTEM'&&msg.eventName==='FLIGHT_ALERT'){
$rootScope.$broadcast('evt_sys_flightAlert',msg);
}elseif(msg.payloadType==='SYSTEM'&&msg.eventName==='TEMPERATURE_SENSOR_DATA_CREATED'){
$rootScope.$broadcast('evt_sensor_temperatures_changed',msg);
}elseif(msg.payloadType==='SYSTEM'&&msg.eventName==='HUMIDITY_SENSOR_DATA_CREATED'){
$rootScope.$broadcast('evt_sensor_humidities_changed',msg);
}elseif(msg.payloadType==='SYSTEM'&&msg.eventName==='FLIGHT_UPDATED'){
$rootScope.$broadcast('evt_sys_flight_changed',msg);
}elseif(msg.payloadType==='SYSTEM'&&msg.eventName==='SOCKET_PING'){
vm.ws.send("Pingback");
}elseif(msg.eventName==='DIRECT_CHAT_STARTED'||msg.eventName==='ADDED_TO_GROUP'){
$rootScope.$broadcast('evt_on_chat_invited',msg);
}else{
$log.debug('Unsupportedmessageviaws:'+msg.payloadType);
}

});
}catch(err){
$log.error(err);
_wsStatus(wsStatus.error);
_forceCloseWS();
}
}else{
_forceCloseWS();
}
}

function_tryReconnectWebsocket(){
varpromise=$timeout(function(){
$timeout.cancel(promise);

if(!_isActive()){
return;
}

_forceCloseWS();
$log.info('retryingwebsocketconnection...');
_updateWebsocketStatus();

},10000);
}

function_wsStatus(status){
varpromise=$timeout(function(){
$timeout.cancel(promise);
vm.wsStatus=status;
$log.info('WSSTATUS:'+vm.wsStatus);
$rootScope.$broadcast("evt_ws_statusChanged",vm.wsStatus);
},500);
}

function_forceCloseWS(){
if(vm.ws){
$log.info('forceclosingWS...');
vm.ws.close(true);
}
vm.ws=null;
}

/*SIP*/
function_updateSIPConnection(){
var_sessionData=AT.SessionUtils.load();
try{
if(_isActive()){//loggedinandnotSITAadmin
vm.sipConfig={
displayName:_sessionData.fullName,
privateId:_sessionData.freeswitchUser,s
publicId:'sip:'+_sessionData.freeswitchUser+'@'+_sessionData.freeswitchDomain,
password:_sessionData.freeswitchPassword,
realm:_sessionData.freeswitchDomain,
wsServer:_utils.pttUrl($location)
};
vm.sipStack=newSIPml.Stack({
realm:vm.sipConfig.realm,
impi:vm.sipConfig.privateId,
impu:vm.sipConfig.publicId,
password:vm.sipConfig.password,
display_name:vm.sipConfig.displayName,
websocket_proxy_url:vm.sipConfig.wsServer,
outbound_proxy_url:null,
enable_rtcweb_breaker:false,//optional
events_listener:{events:'*',listener:_sipStartEventsListener},//optional:'*'meansallevents
sip_headers:[//optional
{name:'User-Agent',value:'IM-client/OMA1.0sipML5-v1.0.0.0'},
{name:'Organization',value:'SITA'}
]
}
);
if(vm.sipStack.start()!=0){
_updateSIPStatus(sipStatus.failed);
}
}else{
_sipHangUp();
if(vm.sipStack){
vm.sipStack.stop();//shutdownallsessions
}
vm.sipStack=null;
vm.sipConfig={};
vm.sipStatus='initial';
vm.sipCallReady=false;
vm.sipInCall=false;

}
}catch(e){
$log.error(e);
}
}


function_sipStartEventsListener(e){
if(e.type=='started'){
_updateSIPStatus(sipStatus.started);
_sipLogin();
}
}

//postinit/hangup/register
function_sipSessionEventsListener(e/*SIPml.Session.Event*/){
if(e.type=='connected'&&e.session==vm.sipRegisterSession){
_updateSIPStatus(sipStatus.connected);
}//elseif(e.session==oSipSessionCall){
}

function_sipCallEventsListener(e){
if(e.type=='connected'&&e.session==vm.sipCallSession){
_updateSIPStatus(sipStatus.connected,true);
}
}

function_sipAudioCall(groupCode){
vm.sipCallSession=vm.sipStack.newSession('call-audio',{
audio_remote:document.getElementById("apc-audio-remote"),
events_listener:{events:'*',listener:_sipCallEventsListener}//optional:'*'meansallevents
});

if(vm.sipCallSession.call('*'+groupCode)!=0){
vm.sipCallSession=null;
_updateSIPStatus(sipStatus.failed);
}
}

function_sipHangUp(){
if(vm.sipCallSession){
vm.sipCallSession.hangup({events_listener:{events:'*',listener:_sipSessionEventsListener}});
$timeout(vm.sipInCall=false);
}
}

function_sipLogin(){
vm.sipRegisterSession=vm.sipStack.newSession('register',{
events_listener:{events:'*',listener:_sipSessionEventsListener}//optional:'*'meansallevents
});
vm.sipRegisterSession.register();
}

function_updateSIPStatus(_status,inCall){

varpromise=$timeout(function(){
$timeout.cancel(promise);
$timeout(vm.sipCallReady=(_status===sipStatus.connected));
$timeout(vm.sipInCall=(_status===sipStatus.connected&&!!inCall));
$timeout(vm.sipStatus=_status);
},1000,false);

}

//isloggedinandnotSITAadmin?
function_isActive(){
var_sessionData=_loadSessionData();
return_sessionData&&_sessionData.customerCode&&!_sessionData.changePasswordRequired;
}

function_currentUid(){
var_sessionData=_loadSessionData();
return_sessionData.uid;
}

function_loadSessionData(){
returnAT.SessionUtils.load();
}

function_loadChats(){
vardef=$q.defer();
$http(AT.RequestUtils.get(_utils.httpBaseUrl($location)+'/internal/chat/list')).then(function(result){
def.resolve(result);
},function(error){
def.reject(error);
$log.error(error);
});
returndef.promise;
};

/*$rootScope.sipAudioCall=_sipAudioCall;
$rootScope.sipHangUp=_sipHangUp;*/

_init();

function_initBrowserNotification(){
//requestpermissiononpageload
if(!/Trident\/|MSIE/.test(window.navigator.userAgent)){
if(Notification.permission!=="granted"){
Notification.requestPermission();
}
}
}

}]);