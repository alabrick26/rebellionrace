// Transcribed from the original frame_13 script (JPEXS: Scripts > frame_13 > DoAction). Compare with your original before pasting.
function joinLobby()
{
   joiningLobby = true;
   var _loc1_ = new Object();
   _loc1_.roomName = "Lobby" + random(300);
   _loc1_.zone = "HW Chat";
   _loc1_.updatable = false;
   _loc1_.userVariablesEnabled = false;
   _loc1_.userListEnabled = false;
   _loc1_.hidden = true;
   es.createRoom(_loc1_);
}
function showError(error)
{
   trace("Error: " + error);
}
function roomJoined(results)
{
   if(results.success)
   {
      if(!joiningLobby)
      {
      }
   }
   else
   {
      showError(results.success);
   }
   joiningLobby = false;
}
function reconnect()
{
   es.onConnection = function(success, error)
   {
      connected = success;
      if(success)
      {
         es.login(username);
      }
   };
   es.loggedIn = function(success, error)
   {
      if(success)
      {
         joinLobby();
      }
      else
      {
         showError(error);
      }
   };
   es.connect(ip,port);
}
function keepAlive()
{
   es.getServerTime();
}
function takeSnapshot(mc, width, height)
{
   var _loc4_ = mc.getBounds();
   var _loc1_ = new flash.display.BitmapData(width,height,true,10027008);
   var _loc2_ = new flash.geom.Matrix();
   _loc1_.draw(mc,_loc2_,new flash.geom.ColorTransform(),"normal");
   return _loc1_;
}
function showHelp()
{
   help = new com.mattel.RebellionRace.UI.Help(this);
}
function handleBoolean(str)
{
   return str.toLowerCase() != "true" ? false : true;
}
function loadTrack(name)
{
   var _loc2_ = new Object();
   _loc2_.url = "GameData/Tracks/" + name;
   _loc2_.trackXML = new XML();
   _loc2_.trackXML.ignoreWhite = true;
   _loc2_.trackXML.onLoad = function()
   {
      TMG.fromXML(this);
      TMG.getTracks().sortOn("name");
      checkAllLoaded();
   };
   filesToLoad.push(_loc2_.trackXML);
   tracksToLoad.push(_loc2_);
}
function loadTheXML()
{
   clearInterval(loadId);
   var _loc1_ = 0;
   var _loc2_;
   while(_loc1_ < tracksToLoad.length)
   {
      _loc2_ = tracksToLoad[_loc1_];
      _loc2_.trackXML.load(_loc2_.url);
      _loc1_ = _loc1_ + 1;
   }
   carXML.load("GameData/Cars.xml");
   themeXML.load("GameData/Themes.xml");
   itemXML.load("GameData/Items.xml");
}
function checkAllLoaded()
{
   var _loc3_ = true;
   var _loc1_ = 0;
   var _loc2_;
   while(_loc1_ < filesToLoad.length)
   {
      _loc2_ = XML(filesToLoad[_loc1_]);
      if(!_loc2_.loaded)
      {
         _loc3_ = false;
         break;
      }
      _loc1_ = _loc1_ + 1;
   }
   if(_loc3_)
   {
      gotoAndStop("Menu");
   }
}
function generateUsername()
{
   var _loc2_;
   _loc2_ = ["zoom","buzz","speedy","zipcrazy","crash","FReaK","inferno","metal","ding","dent","spoiler","lightning","comet","beam","shimmer","hull","chasis","lunatic","berserker","spike","delusional","ego","harvester","hegemony","slither","slimer","axel","rebelyell","scream","ruler","crawler","kingfish","kingpin","bossman","shiner","leadpipe","el_presidente","extinquisher","extinct","mongoose","stench","the_pursuer","Defiant1","Killjoy","elimin8r","DesertDog","impaler","Carbonite","weasel","Snake","Cockroach","Spider","paranoia","phobia","loose_cannon","hammer","boris","boron","crusher","squasher","broiler","bear","cobra","fang","meankitty","Hot_Rod","sneak","Chaser","Night_Racer","crank","Slowpoke","Rusty","Wrench","Termin8r","Roscoe","Juice","Super_Sonic","FlyBoy","Crazy_Eddy","Insane","Fire_Pit","Blaze","Zillion"];
   name = _loc2_[random(_loc2_.length)] + "_" + random(1000);
   _global.username = name;
   return name;
}
var SM = com.utils.SoundManager.getInstance();
SM.initialize(this);
var filesToLoad = new Array();
var soundTrack = new com.utils.SoundTrack(SM);
soundTrack.addSet("setB",1,30);
soundTrack.addSet("setC",1,30);
soundTrack.addSet("setD",1,30);
soundTrack.changeSet("setD");
soundTrack.start();
var username;
var joiningLobby = false;
var es = com.utils.ElectroServer.getInstance();
es.addListener(this);
es.onConnection = function(success, error)
{
   var _loc2_;
   if(success)
   {
      _loc2_ = "k4bj9OVWBHCKKqoOJQLLl8uZSXGwDY0o1NByp5W5T1w%3D";
      if(_global.username == null || _global.username == undefined || _global.username == "")
      {
         username = generateUsername();
      }
      else
      {
         username = _global.username;
      }
      es.login(username,"",{token:unescape(_loc2_)});
   }
   else
   {
      connected = false;
      username = generateUsername();
      showError(error);
   }
};
es.connectionClosed = function()
{
   trace("!!! Connection closed !!!");
};
es.loggedIn = function(success, error)
{
   if(success)
   {
      joinLobby();
   }
   else
   {
      showError(error);
   }
};
var keepAliveId = setInterval(keepAlive,90000);
es.connect(ip,port);
var TM = com.mattel.RebellionRace.Theme.ThemeManager.getInstance();
var themeXML = new XML();
themeXML.ignoreWhite = true;
themeXML.onLoad = function()
{
   var _loc6_ = this.firstChild.childNodes;
   var _loc4_ = 0;
   var _loc5_;
   var _loc3_;
   var _loc2_;
   while(_loc4_ < _loc6_.length)
   {
      _loc5_ = _loc6_[_loc4_];
      _loc3_ = _loc5_.attributes;
      _loc2_ = new com.mattel.RebellionRace.Theme.Theme();
      _loc2_.setName(_loc3_.name);
      _loc2_.setRoad(_loc3_.road);
      _loc2_.setGround(_loc3_.ground);
      _loc2_.setTransitionType(_loc3_.transitionType);
      _loc2_.setCenterLine(_loc3_.centerLine);
      _loc2_.setSideLine(_loc3_.sideLine);
      _loc2_.setDashes(_loc3_.dashes);
      _loc2_.setAmbientElement(_loc3_.ambientElement);
      _loc2_.setRoadFriction(Number(_loc3_.roadFriction));
      _loc2_.setGroundFriction(Number(_loc3_.groundFriction));
      _loc2_.setRoadSkidSound(_loc3_.roadSkidSound);
      _loc2_.setRoadSkidGraphic(_loc3_.roadSkidGraphic);
      _loc2_.setOffRoadSkidGraphic(_loc3_.offRoadSkidGraphic);
      _loc2_.setOffRoadSkidSound(_loc3_.offRoadSkidSound);
      _loc2_.setSkidType(_loc3_.skidType);
      TM.addTheme(_loc2_);
      _loc4_ = _loc4_ + 1;
   }
   checkAllLoaded();
};
filesToLoad.push(themeXML);
var bmpd = takeSnapshot(road_mc,50,50);
var sand_bmpd = takeSnapshot(sand_mc,50,50);
var bush0_bmpd = takeSnapshot(bush_mc,38,38);
var tree0_bmpd = takeSnapshot(bush_mc,60,76);
var CTM = com.mattel.RebellionRace.UI.CarTypeManager.getInstance();
var carXML = new XML();
carXML.ignoreWhite = true;
carXML.onLoad = function()
{
   var _loc10_ = this.firstChild.childNodes;
   var _loc8_ = 0.4;
   var _loc15_ = 1.1;
   var _loc12_ = _loc15_ - _loc8_;
   var _loc6_ = 0.0001;
   var _loc14_ = 0.00025;
   var _loc9_ = _loc14_ - _loc6_;
   var _loc7_ = 0.4;
   var _loc13_ = 1;
   var _loc11_ = _loc13_ - _loc7_;
   var _loc4_ = 0;
   var _loc5_;
   var _loc3_;
   var _loc2_;
   while(_loc4_ < _loc10_.length)
   {
      _loc5_ = _loc10_[_loc4_];
      _loc3_ = _loc5_.attributes;
      _loc2_ = new com.mattel.RebellionRace.UI.CarType();
      _loc2_.setName(unescape(_loc3_.name));
      _loc2_.setId(_loc3_.id);
      _loc2_.setSpeedMin(_loc8_ + Number(_loc3_.speedMin) * _loc12_);
      _loc2_.setSpeedMax(_loc8_ + Number(_loc3_.speedMax * _loc12_));
      _loc2_.setAccelMin(_loc6_ + Number(_loc3_.accelMin) * _loc9_);
      _loc2_.setAccelMax(_loc6_ + Number(_loc3_.accelMax) * _loc9_);
      _loc2_.setHandlingMin(_loc7_ + Number(_loc3_.handlingMin) * _loc11_);
      _loc2_.setHandlingMax(_loc7_ + Number(_loc3_.handlingMax) * _loc11_);
      _loc2_.setSpeedIcons(0);
      _loc2_.setHandlingIcons(0);
      _loc2_.setAccelIcons(0);
      _loc2_.setLocked(_loc3_.locked != "true" ? false : true);
      CTM.addCarType(_loc2_);
      _loc4_ = _loc4_ + 1;
   }
   checkAllLoaded();
   loadCarInformation();
};
filesToLoad.push(carXML);
var ITM = com.mattel.RebellionRace.Item.ItemTypeManager.getInstance();
var itemXML = new XML();
itemXML.ignoreWhite = true;
itemXML.onLoad = function()
{
   var _loc6_ = this.firstChild.childNodes;
   var _loc4_ = 0;
   var _loc5_;
   var _loc2_;
   var _loc3_;
   while(_loc4_ < _loc6_.length)
   {
      _loc5_ = _loc6_[_loc4_];
      _loc2_ = _loc5_.attributes;
      _loc3_ = new com.mattel.RebellionRace.Item.ItemType();
      _loc3_.setName(_loc2_.type);
      _loc3_.setCollisionSound(_loc2_.collisionSound);
      _loc3_.setCollisionFrame(Number(_loc2_.collisionFrame));
      _loc3_.setDecel(Number(_loc2_.decel));
      _loc3_.setBounceFactor(Number(_loc2_.bounceFactor));
      if(_loc2_.carReactionType != undefined)
      {
         _loc3_.setCarReaction(true);
         _loc3_.setCarReactionType(_loc2_.carReactionType);
      }
      if(!isNaN(Number(_loc2_.carReactionFactor)))
      {
         _loc3_.setCarReactionFactor(Number(_loc2_.carReactionFactor));
      }
      if(_loc2_.frequencyOfCollisions != undefined)
      {
         _loc3_.setFrequencyOfCollisions(Number(_loc2_.frequencyOfCollisions));
      }
      if(_loc2_.carVisibleReaction != undefined)
      {
         _loc3_.setCarVisibleReaction(_loc2_.carVisibleReaction);
      }
      if(_loc2_.minVolume != undefined)
      {
         _loc3_.setMinVolume(Number(_loc2_.minVolume));
      }
      if(_loc2_.maxVolume != undefined)
      {
         _loc3_.setMaxVolume(Number(_loc2_.maxVolume));
      }
      if(_loc2_.touchable != undefined)
      {
         _loc3_.setTouchable(handleBoolean(_loc2_.touchable));
      }
      if(_loc2_.reactable != undefined)
      {
         _loc3_.setReactable(handleBoolean(_loc2_.reactable));
      }
      if(_loc2_.endTrack != undefined)
      {
         _loc3_.setEndTrack(handleBoolean(_loc2_.endTrack));
      }
      if(_loc2_.hasShrapnel != undefined)
      {
         _loc3_.setHasShrapnel(handleBoolean(_loc2_.hasShrapnel));
      }
      if(_loc2_.shiftScreen != undefined)
      {
         _loc3_.setShiftScreen(handleBoolean(_loc2_.shiftScreen));
      }
      if(_loc2_.disableOnHit != undefined)
      {
         _loc3_.setDisableOnHit(handleBoolean(_loc2_.disableOnHit));
      }
      if(_loc2_.collectible != undefined)
      {
         _loc3_.setCollectible(handleBoolean(_loc2_.collectible));
      }
      ITM.addItemType(_loc3_);
      _loc4_ = _loc4_ + 1;
   }
   checkAllLoaded();
};
filesToLoad.push(itemXML);
var TMG = com.mattel.RebellionRace.Track.TrackManager.getInstance();
var tracksToLoad = new Array();
loadTrack("grass1.xml");
loadTrack("grass2.xml");
loadTrack("grass3.xml");
loadTrack("grass4.xml");
loadTrack("ice1.xml");
loadTrack("ice2.xml");
loadTrack("ice3.xml");
loadTrack("ice4.xml");
loadTrack("lava1.xml");
loadTrack("lava2.xml");
loadTrack("lava3.xml");
loadTrack("lava4.xml");
var loadId = setInterval(loadTheXML,100);
stop();
