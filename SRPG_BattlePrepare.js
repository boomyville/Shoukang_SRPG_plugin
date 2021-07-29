//====================================================================================================================
// SRPG_BattlePrepare.js
//--------------------------------------------------------------------------------------------------------------------
// free to use and edit    V1.05 Support for SRPG_AdvancedInteraction
//====================================================================================================================
/*:
 * @plugindesc Add battle Prepare phase at the beginning of SRPG battle.
 * @author Shoukang
 *
 * @param disable actor prepare command
 * @desc Can only add or remove actor from formation command if disabled.
 * @type boolean
 * @default true
 *
 * @param auto open menu
 * @desc Open menu automatically after battle start.
 * @type boolean
 * @default true
 *
 * @param textBattlerNumber
 * @desc Name of battler Number. Used in menu window.
 * @default Battler:
 *
 * @param textFinishPrepare
 * @desc Name of Finish Prepare. Used in menu window.
 * @default Ready
 *
 * @param textFormation
 * @desc Name of Formation. Used in menu window.
 * @default Formation
 *
 * @param textPosition
 * @desc Name of Position. Used in menu window.
 * @default Position
 *
 * @param textPrepareEvent
 * @desc Name of Prepare Event. Used in menu window.
 * @default Prepare
 *
 *
 * @param textExchange
 * @desc Name of Exchange position. Used in actor command window.
 * @default Exchange
 *
 * @param textStatus
 * @desc Name of actor Status. Used in actor command window.
 * @default Status
 *
 * @param textRemove
 * @desc Name of Remove actor. Used in actor command window.
 * @default Remove
 *
 * @param lockIconIndex
 * @desc Index of lock Icon.
 * @default 195
 *
 * @help
 *
 * This plugin allows you to prepare before battle. You can change equipment, see enemy's status, remove or add actors,
 * and switch actor positions in battle Prepare phase.
 * Events with <type:actor><id:0> are moveable. AutoBattle members are also moveable in this new version.
 * The new flow is: battleStart---battlePrepare---actorturn---.......
 * ========================================================================================================================
 * event note:
 * <type:afterPrepare>  # start this event when Prepare is finished.
 * <type:prepare>       # start this event when you trigger prepare command in main menu. You can use this event to open shop or do other things you want.
 *==========================================================================================================================
 * PluginCommand
 * DisableSRPGPrepare       Disable battle Prepare
 * EnableSRPGPrepare        Enable battle Prepare
 * =========================================================================================================================
 * Script Calls:
 *
 * $gameParty.setMaxActor(n) set the maximum number of actors in the battle. Default is the number of <type:actor> event.
 * $gameParty.setMinActor(n) set the minimun number of actors in the battle. Default is 1.
 *
 * If you have a specific actor number requirement, run these script calls after the 'SRPGBattle Start' plugin command.
 * These max and min numbers will be erased in the next battle.
 *==========================================================================================================================
 * V1.05 Support for SRPG_AdvancedInteraction
 * V1.04 Fixed some small issues
 * V1.03 Enjoy the new Appearance and features!
 * v1.02 reconstructed some complicated control flows. Don't show actor commands when remove is disabled
 * v1.01 fixed some small bugs and changed the parameter description.
 * v1.00 first release!
 * =========================================================================================================================
 * Compatibility:
 * This plugin made some big changes to SRPG_Core, put it as high as possible but below SRPG_Core!
 * Replace the old Battle UI plugin with the modified one in my github page. https://github.com/ShoukangHong/Shoukang_SRPG_plugin
 */

(function () {
    var parameters = PluginManager.parameters('SRPG_BattlePrepare');
    var _disableActorCommand = !!eval(parameters['disable actor prepare command']);
    var _autoOpenMenu = !!eval(parameters['auto open menu']);
    var _textBattler = parameters['textBattlerNumber']|| 'Battler:';
    var _textFinishPrepare = parameters['textFinishPrepare']|| 'Ready';
    var _textPosition = parameters['textPosition']|| 'Position';
    var _textFormation = parameters['textFormation']|| 'Formation';
    var _textPrepareEvent = parameters['textPrepareEvent']|| 'Prepare';
    var _textExchange = parameters['textExchange']|| 'Exchange';
    var _textStatus = parameters['textStatus']|| 'Status';
    var _textRemove = parameters['textRemove']|| 'Remove';
    var _lockIconIndex = Number(parameters['lockIconIndex']|| 195);

//paramerters from core plugin
    var coreParameters = PluginManager.parameters('SRPG_core');
    var _srpgBattleSwitchID = Number(coreParameters['srpgBattleSwitchID'] || 1);
    var _srpgBestSearchRouteSize = Number(coreParameters['srpgBestSearchRouteSize'] || 20);
    var _textSrpgTurnEnd = coreParameters['textSrpgTurnEnd'] || 'ターン終了';
    var _textSrpgAutoBattle = coreParameters['textSrpgAutoBattle'] || 'オート戦闘';
    var _turnVarID = Number(coreParameters['turnVarID'] || 3);
    var _existActorVarID = Number(coreParameters['existActorVarID'] || 1);
    var _srpgAutoBattleStateId = Number(coreParameters['srpgAutoBattleStateId'] || 14);
    var _srpgWinLoseConditionCommand = coreParameters['srpgWinLoseConditionCommand'] || 'true';

//=================================================================================================
//plugin command
//=================================================================================================
    Game_System.prototype.isPrepareEnabled = function() {
        if (this._enablePrepare === undefined) this._enablePrepare = true;
        return this._enablePrepare;
    };

    Game_System.prototype.setSRPGPrepare = function(value) {
        this._enablePrepare = value;
    };

    var _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.call(this, command, args);
        if (command === 'EnableSRPGPrepare') $gameSystem.setSRPGPrepare(true);
        if (command === 'DisableSRPGPrepare') $gameSystem.setSRPGPrepare(false);
    };

//=================================================================================================
//Helper functions for battle prepare control flow
//=================================================================================================
    Game_Temp.prototype.resetId0Count = function(){
        this._Id0Count = undefined;
    };

//make the table of operatable actor tiles.
    Game_Temp.prototype.srpgMakePrepareTable = function() {
        if (this._Id0Count === 0) return;
        count = 0;
        $gameMap.events().forEach(function(event) {
            if (event.event().meta.type === 'actor' && Number(event.event().meta.id) === 0){
                $gameTemp.pushMoveList([event.posX(), event.posY(), false]);   
                count += 1; 
            }
        });
        this._Id0Count = count;
    };

//change actor, similar to add actor
    Game_Map.prototype.changeActor = function(eventId, actorId) {
        var actor_unit = $gameActors.actor(actorId);
        var event = this.event(eventId);
        if (actor_unit && event) {
            actor_unit.initTp(); 
            var bitmap = ImageManager.loadFace(actor_unit.faceName()); 
            $gameSystem.setEventToUnit(event.eventId(), 'actor', actor_unit.actorId());
            event.setType('actor');
            var xy = event.makeAppearPoint(event, event.posX(), event.posY(), actor_unit.srpgThroughTag());
            event.setPosition(xy[0], xy[1]);
            this.setEventImages();
        }
    };

// A bunch of game party functions to get remaining actors in party, max and min actor number requirements
    Game_Party.prototype.pushRemainingActorList = function(id){
        this._remainingActorList.push(id);
    }

    Game_Party.prototype.removeRemainingActorList = function(id){
        var index = this._remainingActorList.indexOf(id);
        this._remainingActorList.splice(index, 1);
    }

    Game_Party.prototype.getRemainingActorList = function(){
        if (this._remainingActorList) return this._remainingActorList;
        return [];
    }

    Game_Party.prototype.getCurrentActorNumber = function(){
        return this._srpgPrepareAllActors.length - this.getRemainingActorList().length;
    }

    Game_Party.prototype.inRemainingActorList = function(id){
        return this.getRemainingActorList().indexOf(id) >= 0;
    }

//detect the remaining actors and return a list of actor id.
    Game_Party.prototype.initRemainingActorList = function(){
        var actorlist = [];
        $gameMap.events().forEach(function(event) {
            if (event.isType() === 'actor' && !event.isErased()) {
                var actor = $gameSystem.EventToUnit(event.eventId())
                if (actor[1]) actorlist.push(actor[1].actorId());
            }
        });
        var list = [];
        for (var i = 0; i < this._srpgPrepareAllActors.length; i++){
            if (actorlist.indexOf(this._srpgPrepareAllActors[i]) < 0) list.push(this._srpgPrepareAllActors[i]);
        }
        this._remainingActorList = list.sort()
        return this._remainingActorList;
    }

    Game_Party.prototype.inLockedActorList = function(id){
        return this.getLockedActorList().indexOf(id) >= 0;
    }

    Game_Party.prototype.getLockedActorList = function(){
        if (this._lockedActorList) return this._lockedActorList;
        return [];
    }

    Game_Party.prototype.setMaxActor = function(num){
        this._srpgMaxActor = num;
        var eventList = $gameMap.events();
        for (var i = eventList.length - 1; i >= 0; i--) {
            if (this.getMaxActor() >= this.getCurrentActorNumber()) return;
            var event = eventList[i];
            if (event.isType() === 'actor' && Number(event.event().meta.id) === 0 && !event.isErased()){
                $gameTemp.setActiveEvent(event);
                Scene_Base.prototype.commandRemove.call(this);
            }
        }
    }

    Game_Party.prototype.getMaxActor = function(){
        return this._srpgMaxActor;
    }

    Game_Party.prototype.setMinActor = function(num){
        this._srpgMinActor = num;
    }

    Game_Party.prototype.getMinActor = function(){
        return this._srpgMinActor;
    }

    Game_Party.prototype.currentActorNumber = function(){
        return this._srpgPrepareAllActors.length - this._remainingActorList.length;
    }   

    Game_Party.prototype.canAddActor = function(id){
        return this._remainingActorList.length > 0 && this.currentActorNumber() < this._srpgMaxActor;
        // && !$gameActors.actor(id).isDeathStateAffected() && 
    }

    Game_Party.prototype.canRemoveActor = function(){
        return this.currentActorNumber() > this._srpgMinActor;
    }

    Game_Party.prototype.isValidActorNumber = function(){
        return this.currentActorNumber() >= this._srpgMinActor && this.currentActorNumber() <= this._srpgMaxActor;
    }

//detect locked actors and return a list of actor id. Setup min and Max Actor requirement.
    Game_Party.prototype.initLockedActorListandMinMaxActor = function(){
        var actorlist = [];
        var maxActor = 0
        $gameMap.events().forEach(function(event) {
            if (event.event().meta.type === 'actor') maxActor += 1;
            if (event.isType() === 'actor' && !event.isErased() && Number(event.event().meta.id) !== 0) {
                var actor = $gameSystem.EventToUnit(event.eventId())
                if (actor[1]) actorlist.push(actor[1].actorId());
            }
        });
        this._lockedActorList = actorlist.sort()
        this._srpgMaxActor = maxActor;
        this._srpgMinActor = 1;
        return this._lockedActorList;
    }

//add prepare command window refresh flag
    var _SRPG_Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _SRPG_Game_System_initialize.call(this);
        this._SrpgPrepareWindowRefreshFlag = [false, null];
        this._enablePrepare = true;
    };

    Game_System.prototype.srpgPrepareWindowNeedRefresh = function() {
        return this._SrpgPrepareWindowRefreshFlag;
    };

    Game_System.prototype.setSrpgPrepareWindowNeedRefresh = function(battlerArray) {
        this._SrpgPrepareWindowRefreshFlag = [true, battlerArray];
    };

    Game_System.prototype.clearSrpgPrepareWindowNeedRefresh = function() {
        this._SrpgPrepareWindowRefreshFlag = [false, null];
    };

    Game_System.prototype.setSrpgPreparePhaseOpenMenu = function(val) {
        this._srpgPreparePhaseOpenMenu = val;
    };

    Game_System.prototype.isSrpgPreparePhaseOpenMenu = function() {
        return this._srpgPreparePhaseOpenMenu;
    };

//=====================================================================================================================
//Edit other functions to support the prepare phase appearance
//=====================================================================================================================

//Show all party members in prepare phase
    var _SRPG_Game_Party_members = Game_Party.prototype.members;
    Game_Party.prototype.members = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() === 'battle_prepare') {
            var members = this._actors.map(function(id) {
                return $gameActors.actor(id);
                });
            $gameMap.events().forEach(function(event) {
                if (event.event().meta.type === 'actor' && Number(event.event().meta.id) !== 0){
                    var id = Number(event.event().meta.id)
                    if ($gameParty._actors.indexOf(id) < 0) members.splice(0, 0, $gameActors.actor(id))
                }
            });
            this._srpgPrepareAllActors = members.map(function(actor){return actor.actorId()});
            return members;
        } else return _SRPG_Game_Party_members.call(this);
    };

//if an actor is not in battle gret out the image. Show a lock icon if not moveable.
    var _SRPG_Window_MenuStatus_drawItemImage = Window_MenuStatus.prototype.drawItemImage;
    Window_MenuStatus.prototype.drawItemImage = function(index) {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() === 'battle_prepare') {
            var actor = $gameParty.members()[index];
            var rect = this.itemRect(index);
            if ($gameParty.inRemainingActorList(actor.actorId())) {
                this.changePaintOpacity(false);
            } else {
                this.changePaintOpacity(true);
            }
            this.drawActorFace(actor, rect.x + 1, rect.y + 1, Window_Base._faceWidth, Window_Base._faceHeight);
            if ($gameParty.inLockedActorList(actor.actorId())){
                this.drawIcon(_lockIconIndex, Window_Base._faceWidth - Window_Base._iconHeight - 1, rect.y + rect.height - Window_Base._iconHeight - 1)             
            }
        } else {
            _SRPG_Window_MenuStatus_drawItemImage.call(this, index);
        }
    };

//remove AI sprite(Turn end sprite) when remove an actor. But I prefer to use that method in commandRemove
    // var _SRPG_Sprite_Character_updateCharacterFrame = Sprite_Character.prototype.updateCharacterFrame;
    // Sprite_Character.prototype.updateCharacterFrame = function() {
    //     _SRPG_Sprite_Character_updateCharacterFrame.call(this);
    //     if ($gameSystem.isSRPGMode() == true && this._character.isEvent() == true) {
    //         var battlerArray = $gameSystem.EventToUnit(this._character.eventId());
    //         if (!battlerArray) {
       //          this.removeChild(this._turnEndSprite);
       //          this._turnEndSprite = null;
    //         }
    //     }
    // };

//=================================================================================================
//Reconstruct the startMapEvent to include battle prepare phase
//=================================================================================================

    Game_Player.prototype.srpgBattlePrepareSelectId0 = function(event){
        var statusWindow = SceneManager._scene._mapSrpgActorCommandStatusWindow;
        if (statusWindow && statusWindow.isClosing()) return;
        var battlerArray = $gameSystem.EventToUnit(event.eventId());
        $gameSystem.setSrpgActorCommandStatusWindowNeedRefresh(battlerArray);
        $gameTemp.setActiveEvent(event);
        SoundManager.playOk();
        if (_disableActorCommand){
            $gameSystem.setSrpgPrepareWindowNeedRefresh(battlerArray);
            SceneManager._scene.commandExchange();
        } else{
            $gameSystem.setSrpgPrepareWindowNeedRefresh(battlerArray);
            $gameSystem.setSubBattlePhase('prepare_command');
        }
    }

    Game_Player.prototype.srpgBattlePrepareSelectIdN = function(event){
        var battlerArray = $gameSystem.EventToUnit(event.eventId());
        SoundManager.playOk();
        $gameTemp.setResetMoveList(true);
        $gameTemp.setActiveEvent(event);
        $gameSystem.srpgMakeMoveTable(event);
        $gameSystem.setSrpgStatusWindowNeedRefresh(battlerArray);
        $gameSystem.setSubBattlePhase('status_window');
    }

    Game_Player.prototype.srpgBattlePrepareSelectPlayerEvent = function(event){
        if (event.pageIndex() >= 0) event.start();
    }

    Game_Party.prototype.srpgBattlePrepareSelectEmptyActor = function(event, actorId){
        var oldValue = $gameVariables.value(_existActorVarID);
        $gameVariables.setValue(_existActorVarID, oldValue + 1);
        event.appear();
        $gameMap.changeActor(event.eventId(), actorId);
        this.initRemainingActorList(actorId);
    }

    Game_Player.prototype.srpgBattlePrepareExchangePosition = function(event){
        //console.log(statusWindow.isClosed(), $gameSystem.srpgActorCommandStatusWindowNeedRefresh())
        //if (statusWindow.isOpening() || statusWindow.isClosing()) return;
        if (Number(event.event().meta.id) === 0 && event.eventId() !== $gameTemp.activeEvent().eventId()) {
            var battlerArray = $gameSystem.EventToUnit(event.eventId());
            SoundManager.playOk();
            $gameTemp.clearMoveTable();
            $gameTemp.activeEvent().swap(event); //exchange event position;
            $gameTemp.clearActiveEvent();
            $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
            $gameSystem.setSubBattlePhase('normal');
            $gameTemp.setResetMoveList(true);
            $gameTemp.srpgMakePrepareTable();
        } else if (event.eventId() !== $gameTemp.activeEvent().eventId()) {
            SoundManager.playBuzzer();
        } else if(!SceneManager._scene._mapSrpgActorCommandStatusWindow.isOpening()){
            SceneManager._scene.srpgCancelExchangePosition();
        }
    }

//add conditions of battle_prepare phase, prepare_command subphase and exchange_position subphase.
    var _SRPG_Game_Player_startMapEvent = Game_Player.prototype.startMapEvent
    Game_Player.prototype.startMapEvent = function(x, y, triggers, normal) {
        if ($gameSystem.isSRPGMode() == true && !$gameMap.isEventRunning() && $gameSystem.isBattlePhase() === 'battle_prepare'){
            var event = $gameMap.eventsXy(x, y)[0];
            if (!event) return;
            if ($gameSystem.isSubBattlePhase() === 'normal' && triggers[0] === 0) {
                if (event.isType() === 'actor' && Number(event.event().meta.id) === 0 && !event.isErased()) {
                    this.srpgBattlePrepareSelectId0(event);
                } else if (event.isType() === 'enemy' || (event.isType() === 'actor' && !event.isErased())) {
                    this.srpgBattlePrepareSelectIdN(event);
                } else if (event.isType() === 'playerEvent') {
                    this.srpgBattlePrepareSelectPlayerEvent(event);
                } else if (event.event().meta.type === 'actor' && event.isErased()){ //if there's remaining actor add actor.
                    var actorId = $gameParty.getRemainingActorList()[0]
                    if (!_disableActorCommand && $gameParty.canAddActor(actorId)) {
                        SoundManager.playOk();
                        $gameParty.srpgBattlePrepareSelectEmptyActor(event, actorId);
                    }
                } else SoundManager.playBuzzer();
            } else if ($gameSystem.isSubBattlePhase() === 'exchange_position' && triggers[0] === 0){
                if (event.event().meta.type === 'actor') this.srpgBattlePrepareExchangePosition(event);
            }
        } else _SRPG_Game_Player_startMapEvent.call(this, x, y, triggers, normal)
    };

//don't move the player when prepare command is open
    var _SRPG_Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isSubBattlePhase() === 'prepare_command') {
            return false;
        } else return _SRPG_Game_Player_canMove.call(this);
    };

//===================================================================================
//reconstruct update call menu function (not necessary, just because i feel this function is too twisted)
//===================================================================================

    Scene_Map.prototype.srpgCanNotUpdateCallMenu = function(){
        return ($gameSystem.isSubBattlePhase() === 'invoke_action' ||
        $gameSystem.srpgWaitMoving() == true ||
        $gameTemp.isAutoMoveDestinationValid() == true ||
        $gameSystem.isSubBattlePhase() === 'status_window' ||
        $gameSystem.isSubBattlePhase() === 'actor_command_window' ||
        $gameSystem.isSubBattlePhase() === 'battle_window' ||
        $gameSystem.isSubBattlePhase() === 'prepare_command' || //shoukang add new condition: $gameSystem.isSubBattlePhase() === 'prepare_command'
        ($gameSystem.isBattlePhase() != 'actor_phase' &&
        $gameSystem.isBattlePhase() != 'battle_prepare')) //shoukang add new condition: $gameSystem.isBattlePhase() != 'battle_prepare'
    }

    Scene_Map.prototype.srpgCancelActorMove = function(){
        SoundManager.playCancel();
        $gameSystem.setSubBattlePhase('normal');
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameParty.clearSrpgBattleActors();
        $gameTemp.clearActiveEvent();
        $gameTemp.clearMoveTable();
    }

    Scene_Map.prototype.srpgCancelActorTarget = function(){
        SoundManager.playCancel();
        var event = $gameTemp.activeEvent();
        var battlerArray = $gameSystem.EventToUnit(event.eventId());
        $gameTemp.clearMoveTable();
        $gameTemp.initialMoveTable($gameTemp.originalPos()[0], $gameTemp.originalPos()[1], battlerArray[1].srpgMove());
        event.makeMoveTable($gameTemp.originalPos()[0], $gameTemp.originalPos()[1], battlerArray[1].srpgMove(), [0], battlerArray[1].srpgThroughTag());
        var list = $gameTemp.moveList();
        for (var i = 0; i < list.length; i++) {
            var pos = list[i];
            var flag = $gameSystem.areTheyNoUnits(pos[0], pos[1], '');
            if (flag == true && _srpgBestSearchRouteSize > 0) event.makeRangeTable(pos[0], pos[1], battlerArray[1].srpgWeaponRange(), [0], pos[0], pos[1], $dataSkills[battlerArray[1].attackSkillId()]);
        }
        $gameTemp.pushRangeListToMoveList();
        $gameTemp.setResetMoveList(true);
        $gameSystem.setSrpgActorCommandWindowNeedRefresh(battlerArray);
        $gameSystem.setSubBattlePhase('actor_command_window');
    }

//This is the new condition I add.
    Scene_Map.prototype.srpgCancelExchangePosition = function() {
        SoundManager.playCancel();
        $gameSystem.clearSrpgPrepareWindowNeedRefresh();
        $gameSystem.setSubBattlePhase('normal');
        $gameTemp._MoveList = [];
        $gameTemp.setResetMoveList(true);
        $gameTemp.clearActiveEvent();
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameTemp.clearMoveTable();
        $gameTemp.srpgMakePrepareTable();
    }

//drag the origingal updatecallmenu method here so I can rewrite, I can't find any better way.
    Scene_Map.prototype.updateCallMenu = function() {
        if (this.isMenuEnabled()) {
            if (this.isMenuCalled()) {
                this.menuCalling = true;
            }
            if (this.menuCalling && !$gamePlayer.isMoving()) {
                this.callMenu();
            }
        } else {
            this.menuCalling = false;
        }
    };

//This part is too complicated, I reconstruct and add my conditions
    var _SRPG_SceneMap_updateCallMenu = Scene_Map.prototype.updateCallMenu;
    Scene_Map.prototype.updateCallMenu = function() {
        if ($gameSystem.isSRPGMode() == true) {
            if (this.srpgCanNotUpdateCallMenu()) {
                this.menuCalling = false;
                return;
            }
            if ($gameSystem.isSubBattlePhase() === 'normal') {
                if (Input.isTriggered('pageup')) {
                    SoundManager.playCursor();
                    $gameSystem.getNextLActor();
                } else if (Input.isTriggered('pagedown')) {
                    SoundManager.playCursor();
                    $gameSystem.getNextRActor();
                }
            }
            if ($gameSystem.isSubBattlePhase() === 'actor_move') {
                if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this.srpgCancelActorMove();
                }
            } else if ($gameSystem.isSubBattlePhase() === 'actor_target' || $gameSystem.isSubBattlePhase() === 'actor_Interaction') {
                if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this.srpgCancelActorTarget();
                }
            } else if ($gameSystem.isSubBattlePhase() === 'exchange_position'){
            //shoukang add exchange position condition
                if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                    this.srpgCancelExchangePosition();
                }
            } else if ($gameSystem.isSrpgPreparePhaseOpenMenu() && !$gameMap.isEventRunning()){
                this.callMenu();
                $gameSystem.setSrpgPreparePhaseOpenMenu(false);
            } else _SRPG_SceneMap_updateCallMenu.call(this);
        } else {
            _SRPG_SceneMap_updateCallMenu.call(this);
        }
    };



//update prepare command window
    var _SRPG_MB_SceneMap_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _SRPG_MB_SceneMap_update.call(this);
        if ($gameSystem.isSRPGMode() && $gameSystem.isBattlePhase() === 'battle_prepare') {
            if ($gameTemp.moveList().length === 0 && !$gameMap.isEventRunning()) $gameTemp.srpgMakePrepareTable();
            var flag = $gameSystem.srpgPrepareWindowNeedRefresh();
            if (flag && flag[0]) {
                if (!this._mapSrpgPrepareWindow.isOpen() && !this._mapSrpgPrepareWindow.isOpening()) {
                    this._mapSrpgPrepareWindow.setup(flag[1][1]);
                }
            } else {
                if (this._mapSrpgPrepareWindow.isOpen() && !this._mapSrpgPrepareWindow.isClosing()) {
                    this._mapSrpgPrepareWindow.close();
                }
            }
        }
    };

//=============================================================================
// do srpgStartBattlePrepare when start Srpg battle
//=============================================================================
    Game_System.prototype.srpgStartBattlePrepare = function() {
        this.setBattlePhase('battle_prepare');
        this.setSubBattlePhase('normal');
        $gameParty.members(); //init all members
        $gameTemp.resetId0Count();//make prepare table
        $gameParty.initLockedActorListandMinMaxActor();
        $gameParty.initRemainingActorList();
        if (_autoOpenMenu) this.setSrpgPreparePhaseOpenMenu(true);
    };

//Rewrite startSRPG to run srpgStartBattlePrepare instead of actor turn when SRPG battle start
    Game_System.prototype.startSRPG = function() {
        this._SRPGMode = true;
        $gameSwitches.setValue(_srpgBattleSwitchID, true);
        this._isBattlePhase = 'initialize';
        this._isSubBattlePhase = 'initialize';
        $gamePlayer.refresh();
        $gameTemp.clearActiveEvent();
        this.clearData(); //データの初期化
        this.setAllEventType(); //イベントタイプの設定
        this.setSrpgActors(); //アクターデータの作成
        this.setSrpgEnemys(); //エネミーデータの作成
        $gameMap.setEventImages();   // ユニットデータに合わせてイベントのグラフィックを変更する
        this.runBattleStartEvent(); // ゲーム開始時の自動イベントを実行する
        $gameVariables.setValue(_turnVarID, 1); //ターン数を初期化する
        $gameSystem.resetSearchedItemList(); //探索済み座標を初期化する
        this.clearSrpgPrepareWindowNeedRefresh();//shoukang initialize
        if (this.isPrepareEnabled()){
            this.srpgStartBattlePrepare();//shoukang start Prepare if enabled
        } else this.srpgStartActorTurn();//アクターターンを開始する
    };

//=====================================================================================================================
//Actor prepare window
//=====================================================================================================================
//define event handlers
    Scene_Map.prototype.commandPartyMember = function() {
        var index = this._mapSrpgPrepareWindow.currentExt();
        $gameMap.changeActor($gameTemp.activeEvent().eventId(), index);
        $gameTemp.clearActiveEvent();
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameSystem.clearSrpgPrepareWindowNeedRefresh();
        $gameSystem.setSubBattlePhase('normal');
        $gameParty.initRemainingActorList();
    };

    Scene_Map.prototype.commandExchange = function() {
        $gameTemp.pushMoveList([$gameTemp.activeEvent().posX(), $gameTemp.activeEvent().posY(), true]);
        $gameTemp.setResetMoveList(true);
        $gameSystem.setSubBattlePhase('exchange_position');
        $gameSystem.clearSrpgPrepareWindowNeedRefresh();
    };

    Scene_Map.prototype.commandSrpgPrepareStatus = function() {
        var battlerArray = $gameSystem.EventToUnit($gameTemp.activeEvent().eventId());
        SoundManager.playOk();
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameSystem.clearSrpgPrepareWindowNeedRefresh();
        $gameTemp.setResetMoveList(true);
        $gameTemp.setActiveEvent(event);
        $gameSystem.srpgMakeMoveTable(event);
        $gameSystem.setSrpgStatusWindowNeedRefresh(battlerArray);
        $gameSystem.setSubBattlePhase('status_window');
    };
//This is also used in menu window
    Scene_Base.prototype.commandRemove = function() {
        var oldValue = $gameVariables.value(_existActorVarID);
        var id = $gameTemp.activeEvent().eventId();
        var actorId = $gameSystem.EventToUnit(id)[1].actorId()
        $gameVariables.setValue(_existActorVarID, oldValue - 1);
        $gameTemp.clearActiveEvent();
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameMap.event(id).setType('');
        $gameMap.event(id).erase();
        $gameSystem._EventToUnit[id] = null;
        $gameSystem.clearSrpgPrepareWindowNeedRefresh();
        $gameSystem.setSubBattlePhase('normal');
        //remove AI sprite(Turn end sprite) when remove an actor. It's kind of a hack way but 
        //I hope this provides a better performance as it doesn't need to check continuously.
        if (!SceneManager._scene._spriteset) return;
        //console.log("?")
        $gameParty.pushRemainingActorList(actorId);
        SceneManager._scene._spriteset._characterSprites.forEach(function(sprite) {
            if (sprite._character instanceof Game_Event && sprite._character.eventId() === id) {
                sprite.removeChild(sprite._turnEndSprite);
                sprite._turnEndSprite = null;
            }
        });
    };

    Scene_Map.prototype.cancelPrepareCommand = function() {
        $gameSystem.setSubBattlePhase('normal');
        $gameTemp.clearActiveEvent();
        $gameSystem.clearSrpgActorCommandStatusWindowNeedRefresh();
        $gameSystem.clearSrpgPrepareWindowNeedRefresh();
    };

//add actor commands
    Window_ActorCommand.prototype.addPartyMemberCommand = function() {
        var remainingactorlist = $gameParty.getRemainingActorList();
        for (var i = 0; i < remainingactorlist.length; i++){
            actor = $gameActors.actor(remainingactorlist[i])
            this.addCommand(actor.name(), 'partymember', true, actor.actorId()); 
        }
    };

    Window_ActorCommand.prototype.addExchangeCommand = function() {
        this.addCommand(_textExchange, 'exchange', true);
    };

    Window_ActorCommand.prototype.addSrpgPrepareStatusCommand = function() {
        this.addCommand(_textStatus, 'status', true);
    };

    Window_ActorCommand.prototype.addRemoveCommand = function() {
        this.addCommand(_textRemove, 'remove', $gameParty.canRemoveActor());
    };

    Window_ActorCommand.prototype.addCancelPrepareCommand = function() {
        this.addCommand('cancel', 'cancel', true);
    };

//battle Prepare phase add these commands
    var _SRPG_Window_ActorCommand_makeCommandList = Window_ActorCommand.prototype.makeCommandList;
    Window_ActorCommand.prototype.makeCommandList = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() === 'battle_prepare') {
            if (this._actor) {
                this.addPartyMemberCommand();
                this.addExchangeCommand();
                this.addSrpgPrepareStatusCommand();
                this.addRemoveCommand();
            }
        } else _SRPG_Window_ActorCommand_makeCommandList.call(this);
    };

//Create windows
    Scene_Map.prototype.createPrepareWindow = function() {
        this._mapSrpgPrepareWindow = new Window_ActorCommand();
        this._mapSrpgPrepareWindow.x = Math.max(Graphics.boxWidth / 2 - this._mapSrpgPrepareWindow.windowWidth(), 0);
        this._mapSrpgPrepareWindow.y = Math.max(Graphics.boxHeight / 2 - this._mapSrpgPrepareWindow.windowHeight(), 0);
        this._mapSrpgPrepareWindow.setHandler('partymember',  this.commandPartyMember.bind(this));
        this._mapSrpgPrepareWindow.setHandler('exchange',  this.commandExchange.bind(this));
        this._mapSrpgPrepareWindow.setHandler('status',  this.commandSrpgPrepareStatus.bind(this));
        this._mapSrpgPrepareWindow.setHandler('remove',  this.commandRemove.bind(this));
        this._mapSrpgPrepareWindow.setHandler('cancel', this.cancelPrepareCommand.bind(this));
        this.addWindow(this._mapSrpgPrepareWindow);
    };

    var _SRPG_SceneMap_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function() {
        _SRPG_SceneMap_createAllWindows.call(this);
        this.createPrepareWindow();
    };

//======================================================================================
//Change and add commands in main menu
//======================================================================================
//define event handlers
    Scene_Menu.prototype.commandFinishPrepare = function() {
        this.popScene();
        $gameSystem.clearSrpgAllActors();
        $gameMap.events().forEach(function(event) {
            if (event.isType() === 'afterPrepare') {
                if (event.pageIndex() >= 0) event.start();
                $gameTemp.pushSrpgEventList(event);
            }
            if (event.isType() === 'actor' && !event.isErased()) {
                var actor = $gameSystem.EventToUnit(event.eventId());
                if (actor[1]) $gameSystem.pushSrpgAllActors(event.eventId()); //refresh SrpgAllActors list
            } else if (event.isType() === 'actor' && event.isErased()) event.setType('');
        });
        $gameTemp.clearMoveTable();
        $gameSystem.setBattlePhase('actor_phase');
        $gameSystem.srpgStartActorTurn();
    };

    Scene_Menu.prototype.SrpgRefreshPosition = function() {
        var scene = this
        var rActorList = $gameParty.getRemainingActorList()
        var addList = []
        $gameParty._srpgPrepareAllActors.forEach(function(id){
            if (rActorList.indexOf(id) < 0) addList.push(id)
        });
        //console.log(rActorList);
        $gameMap.events().forEach(function(event) {
            if (event.isType() === 'actor' && !event.isErased()) {
                var actorArray = $gameSystem.EventToUnit(event.eventId())
                if (actorArray && actorArray[1] && $gameParty.inRemainingActorList(actorArray[1].actorId())) {
                    //console.log($gameParty.getRemainingActorList(), rActorList);
                    $gameTemp.setActiveEvent(event);
                    scene.commandRemove();
                } else if (actorArray && actorArray[1]) {
                    addList.splice(addList.indexOf(actorArray[1].actorId()), 1)
                }
            }
        });
        //console.log(addList);
        $gameMap.events().forEach(function(event) {
            var battleArray = $gameSystem.EventToUnit(event.eventId())
            if (event.event().meta.type === 'actor' && (!battleArray || !battleArray[1])) {
                if (addList.length > 0){
                    $gameParty.srpgBattlePrepareSelectEmptyActor(event, addList.pop());
                } else return;
            }
        });
    };

    Scene_Menu.prototype.commandPrepareEvent = function() {
        $gameMap.events().forEach(function(event) {
            if (event.isType() === 'prepare') {
                if (event.pageIndex() >= 0) event.start();
                $gameTemp.pushSrpgEventList(event);
            }
        });
        SceneManager.pop();
    };

//play ok sound for onPersonalOk (status, equip....)
    var shoukang_Scene_Menu_onPersonalOk = Scene_Menu.prototype.onPersonalOk
    Scene_Menu.prototype.onPersonalOk = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() == 'battle_prepare'){
            SoundManager.playOk();
        }
        shoukang_Scene_Menu_onPersonalOk.call(this);
    };

//do not play ok sound when selecting menustatus.
    var _shoukang_MenuStatus_playOkSound = Window_MenuStatus.prototype.playOkSound;
    Window_MenuStatus.prototype.playOkSound = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() == 'battle_prepare') return;
        else _shoukang_MenuStatus_playOkSound.call(this);
    };

    var _shoukang_Scene_Menu_onFormationCancel = Scene_Menu.prototype.onFormationCancel;
    Scene_Menu.prototype.onFormationCancel = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() == 'battle_prepare'){
            if ($gameParty.isValidActorNumber()){
                this.SrpgRefreshPosition();
                this._statusWindow.deselect();
                this._commandWindow.activate();
            } else {
                SoundManager.playBuzzer();
                this._statusWindow.activate();
            }
        } else _shoukang_Scene_Menu_onFormationCancel.call(this);
    };

    var _shoukang_Scene_Menu_onFormationOk = Scene_Menu.prototype.onFormationOk;
    Scene_Menu.prototype.onFormationOk = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() == 'battle_prepare'){
            var index = this._statusWindow.index();
            var actor = $gameParty.members()[index];
            var id = actor.actorId()
            //console.log(index, id)
            //console.log($gameParty.inRemainingActorList(id))
            if ($gameParty.inLockedActorList(id)){ // || $gameActors.actor(id).isDeathStateAffected()
                SoundManager.playBuzzer();
            } else if ($gameParty.inRemainingActorList(id)){
                    SoundManager.playEquip();
                    $gameParty.removeRemainingActorList(id);
            } else {
                SoundManager.playEquip();
                $gameParty.pushRemainingActorList(id);
            }
            this._SrpgMemberRequirementWindow.refresh();
            this._statusWindow.redrawItem(index);
            this._statusWindow.activate();
        } else _shoukang_Scene_Menu_onFormationOk.call(this);
    };

    Scene_Menu.prototype.commandConfirmStartBattle = function() {
        //TODO: Implement here
        this._commandWindow.activate();
    };

//add commands
    Window_MenuCommand.prototype.addFinishPrepareCommand = function() {
        this.addCommand(_textFinishPrepare, 'finish prepare', true);
    };

    Window_MenuCommand.prototype.addSrpgPositionCommand = function() {
        this.addCommand(_textPosition, 'position', true);
    };

    Window_MenuCommand.prototype.addSRPGFormationCommand = function() {
        this.addCommand(_textFormation, 'formation', true);
    };

    Window_MenuCommand.prototype.addPrepareEventCommand = function() {
        var menuWindow = this;
        $gameMap.events().some(function(event) {
            if (event.isType() === 'prepare') menuWindow.addCommand(_textPrepareEvent, 'prepare', true);
        });
    };

    var _SRPG_Window_MenuCommand_makeCommandList = Window_MenuCommand.prototype.makeCommandList;
    Window_MenuCommand.prototype.makeCommandList = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() == 'battle_prepare') {
            this.addFinishPrepareCommand();
            if (_srpgWinLoseConditionCommand == 'true') this.addWinLoseConditionCommand();
            this.addSRPGFormationCommand();
            this.addSrpgPositionCommand();
            this.addPrepareEventCommand();
            if (this.needsCommand('equip')) this.addCommand(TextManager.equip, 'equip', true);
            if (this.needsCommand('status')) this.addCommand(TextManager.status, 'status', true);
            this.addOriginalCommands();
            this.addOptionsCommand();
            this.addSaveCommand();
            this.addGameEndCommand();
        } else _SRPG_Window_MenuCommand_makeCommandList.call(this);
    };

//In prepare phase register these commands
    var _SRPG_SceneMenu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function() {
        _SRPG_SceneMenu_createCommandWindow.call(this);
        if ($gameSystem.isSRPGMode() === true && $gameSystem.isBattlePhase() === 'battle_prepare') {
            this._commandWindow.setHandler('finish prepare', this.commandFinishPrepare.bind(this));
            this._commandWindow.setHandler('position', this.popScene.bind(this));
            this._commandWindow.setHandler('prepare', this.commandPrepareEvent.bind(this));
            this._commandWindow.setHandler('cancel', this.popScene.bind(this));
            // TODO: replace 'cancel' handler with this
            //this._commandWindow.setHandler('cancel', this.commandConfirmStartBattle.bind(this));
        }
    };

//======================================================================================================
// SRPG Battle member requirement window
//======================================================================================================
    window.Window_SrpgMemberRequirement = function (){
        this.initialize.apply(this, arguments);
    }

    Window_SrpgMemberRequirement.prototype = Object.create(Window_Base.prototype);
    Window_SrpgMemberRequirement.prototype.constructor = Window_SrpgMemberRequirement;

    Window_SrpgMemberRequirement.prototype.initialize = function(x, y) {
        Window_Base.prototype.initialize.call(this, x, y, 240, this.fittingHeight(1));
        this.refresh();
    };

    Window_SrpgMemberRequirement.prototype.drawLabel = function(x, width){
        this.changeTextColor(this.systemColor())
        this.drawText(_textBattler, x, 0, width/2, 'left');
    }

    Window_SrpgMemberRequirement.prototype.drawCurrentBattlerNumber = function(x, width){
        if ($gameParty.isValidActorNumber()) {
            this.changeTextColor(this.normalColor());
        } else{
            this.changeTextColor(this.deathColor());
        }
        this.drawText($gameParty.getCurrentActorNumber(), (width + x)/2, 0, width/4, 'center');
    }

    Window_SrpgMemberRequirement.prototype.drawRequiredBattlerNumber = function(x, width){
        this.drawText('/', x + width/2, 0, width/2, 'center');
        if ($gameParty.getMinActor() === 1) this.drawText($gameParty.getMaxActor(),  3 * width/4, 0, width/4, 'right');
        else this.drawText($gameParty.getMinActor() + '-' + $gameParty.getMaxActor(),  2 * x + 3 * width/4, 0, width/4, 'right');
        this.resetTextColor()
    }

    Window_SrpgMemberRequirement.prototype.refresh = function() {
        var x = this.textPadding();
        var width = this.contents.width - this.textPadding() * 2;
        this.contents.clear();
        this.drawCurrentBattlerNumber(x, width);
        this.drawLabel(x, width);
        this.drawRequiredBattlerNumber(x, width);
        this.resetTextColor()
    };

    Scene_Menu.prototype.createSrpgMemberRequirementWindow = function() {
        if ($gameSystem.isSRPGMode() == true && $gameSystem.isBattlePhase() === 'battle_prepare'){
            this._SrpgMemberRequirementWindow = new Window_SrpgMemberRequirement(0, 0);
            this._SrpgMemberRequirementWindow.y = Graphics.boxHeight - this._SrpgMemberRequirementWindow.height - this._goldWindow.height;
            this.addWindow(this._SrpgMemberRequirementWindow);
        }
    };

//Create Srpg member requirement window
    var _shoukang_Scene_Menu_create = Scene_Menu.prototype.create
    Scene_Menu.prototype.create = function() {
        _shoukang_Scene_Menu_create.call(this);
        this.createSrpgMemberRequirementWindow();
    };

})();
