import Asset, { AssetType } from '../../src/types/Asset';
import { ChargePointErrorCode, ChargePointStatus, OCPPStatusNotificationRequest } from '../../src/types/ocpp/OCPPServer';
import { SapSmartChargingSetting, SettingDB, SmartChargingSetting, SmartChargingSettingsType } from '../../src/types/Setting';
import { StaticLimitAmps, Voltage } from '../../src/types/ChargingStation';
import Transaction, { CSPhasesUsed } from '../../src/types/Transaction';
import chai, { assert, expect } from 'chai';

import AssetStorage from '../../src/storage/mongodb/AssetStorage';
import CentralServerService from './client/CentralServerService';
import { ChargingProfile } from '../../src/types/ChargingProfile';
import ChargingStationContext from './context/ChargingStationContext';
import ChargingStationStorage from '../../src/storage/mongodb/ChargingStationStorage';
import Constants from '../../src/utils/Constants';
import ContextDefinition from './context/ContextDefinition';
import ContextProvider from './context/ContextProvider';
import Cypher from '../../src/utils/Cypher';
import LogStorage from '../../src/storage/mongodb/LogStorage';
import MongoDBStorage from '../../src/storage/mongodb/MongoDBStorage';
import { ServerAction } from '../../src/types/Server';
import SiteAreaContext from './context/SiteAreaContext';
import SiteContext from './context/SiteContext';
import SmartChargingFactory from '../../src/integration/smart-charging/SmartChargingFactory';
import SmartChargingIntegration from '../../src/integration/smart-charging/SmartChargingIntegration';
import TenantContext from './context/TenantContext';
import TransactionStorage from '../../src/storage/mongodb/TransactionStorage';
import Utils from '../../src/utils/Utils';
import chaiSubset from 'chai-subset';
import config from '../config';
import global from '../../src/types/GlobalType';
import moment from 'moment';
import responseHelper from '../helpers/responseHelper';

chai.use(chaiSubset);
chai.use(responseHelper);

let smartChargingIntegration: SmartChargingIntegration<SmartChargingSetting>;
let smartChargingIntegrationWithDifferentBufferValues: SmartChargingIntegration<SmartChargingSetting>;
let smartChargingIntegrationWithoutStickyLimit: SmartChargingIntegration<SmartChargingSetting>;
let smartChargingIntegrationWithoutPriorities: SmartChargingIntegration<SmartChargingSetting>;

class TestData {
  public tenantContext: TenantContext;
  public centralUserContext: any;
  public centralUserService: CentralServerService;
  public userContext;
  public userService: CentralServerService;
  public siteContext: SiteContext;
  public siteAreaContext: SiteAreaContext;
  public siteAreaContext1: SiteAreaContext;
  public chargingStationContext: ChargingStationContext;
  public chargingStationContext1: ChargingStationContext;
  public chargingStationContext2: ChargingStationContext;
  public createdUsers = [];
  public isForcedSynchro: boolean;
  public chargingSettingProvided = true;
  public newAsset: Asset;

  public static async setSmartChargingValidCredentials(testData): Promise<void> {
    const sapSmartChargingSettings = TestData.getSmartChargingSettings();
    sapSmartChargingSettings.password = await Cypher.encrypt(testData.tenantContext.getTenant(), sapSmartChargingSettings.password);
    await TestData.saveSmartChargingSettings(testData, sapSmartChargingSettings);
    aCBufferFactor = 1 + sapSmartChargingSettings.limitBufferAC / 100,
    dCBufferFactor = 1 + sapSmartChargingSettings.limitBufferDC / 100,
    smartChargingIntegration = await SmartChargingFactory.getSmartChargingImpl(testData.tenantContext.getTenant());
    sapSmartChargingSettings.limitBufferDC = 10,
    sapSmartChargingSettings.limitBufferAC = 5,
    await TestData.saveSmartChargingSettings(testData, sapSmartChargingSettings);
    smartChargingIntegrationWithDifferentBufferValues = await SmartChargingFactory.getSmartChargingImpl(testData.tenantContext.getTenant());
    sapSmartChargingSettings.stickyLimitation = false;
    await TestData.saveSmartChargingSettings(testData, sapSmartChargingSettings);
    smartChargingIntegrationWithoutStickyLimit = await SmartChargingFactory.getSmartChargingImpl(testData.tenantContext.getTenant());
    sapSmartChargingSettings.prioritizationParametersActive = false;
    await TestData.saveSmartChargingSettings(testData, sapSmartChargingSettings);
    smartChargingIntegrationWithoutPriorities = await SmartChargingFactory.getSmartChargingImpl(testData.tenantContext.getTenant());
    expect(smartChargingIntegration).to.not.be.null;
    expect(smartChargingIntegrationWithDifferentBufferValues).to.not.be.null;
    expect(smartChargingIntegrationWithoutStickyLimit).to.not.be.null;
    expect(smartChargingIntegrationWithoutPriorities).to.not.be.null;
  }

  public static getSmartChargingSettings(): SapSmartChargingSetting {
    return {
      optimizerUrl: config.get('smartCharging.optimizerUrl'),
      user: config.get('smartCharging.user'),
      password: config.get('smartCharging.password'),
      stickyLimitation: config.get('smartCharging.stickyLimitation'),
      limitBufferAC: config.get('smartCharging.limitBufferAC'),
      limitBufferDC: config.get('smartCharging.limitBufferDC'),
      prioritizationParametersActive: config.get('smartCharging.prioritizationParametersActive'),
    } as SapSmartChargingSetting;
  }

  public static async saveSmartChargingSettings(testData, sapSmartChargingSettings: SapSmartChargingSetting): Promise<void> {
    const tenantSmartChargingSettings = await testData.userService.settingApi.readByIdentifier({ 'Identifier': 'smartCharging' });
    expect(tenantSmartChargingSettings.data).to.not.be.null;
    const componentSetting: SettingDB = tenantSmartChargingSettings.data;
    componentSetting.content.type = SmartChargingSettingsType.SAP_SMART_CHARGING;
    componentSetting.content.sapSmartCharging = sapSmartChargingSettings;
    componentSetting.sensitiveData = ['content.password.secretKey'];
    await testData.userService.settingApi.update(componentSetting);
  }

  // Validate properties of a charging profile with the related transaction
  public static validateAndReturnChargingProfile(chargingProfiles: ChargingProfile[], transaction: Transaction): ChargingProfile {
    const chargingProfile = chargingProfiles.find((cp) => cp.profile.transactionId === transaction.id);
    expect(chargingProfile).containSubset({
      'chargingStationID': transaction.chargeBoxID,
      'connectorID': transaction.connectorId,
      'chargePointID': 1,
      'profile': {
        'chargingProfileId': chargingProfile.profile.chargingProfileId,
        'chargingProfileKind': 'Absolute',
        'chargingProfilePurpose': 'TxProfile',
        'stackLevel': 2,
        'transactionId': transaction.id,
        'chargingSchedule': {
          'chargingRateUnit': 'A',
          'duration': chargingProfile.profile.chargingSchedule.chargingSchedulePeriod.length * 15 * 60
        }
      }
    });
    return chargingProfile;
  }

  public static async sendMeterValue(voltage: Voltage, amperagePerPhase:number, transaction: Transaction, chargingStationContext: ChargingStationContext,
      phasesUsed?: CSPhasesUsed): Promise<void> {
    const meterValues = {
      energyActiveImportMeterValue: 0,
      amperageMeterValue: amperagePerPhase,
      voltageMeterValue: voltage,
      powerImportMeterValue: !phasesUsed ? amperagePerPhase * voltage : 0,
      voltageL1MeterValue: 0,
      voltageL2MeterValue: 0,
      voltageL3MeterValue: 0,
      amperageL1MeterValue: 0,
      amperageL2MeterValue: 0,
      amperageL3MeterValue: 0,
    };
    if (phasesUsed) {
      if (phasesUsed.csPhase1) {
        meterValues.amperageL1MeterValue = amperagePerPhase;
        meterValues.voltageL1MeterValue = voltage;
        meterValues.powerImportMeterValue += amperagePerPhase * voltage;
      }
      if (phasesUsed.csPhase2) {
        meterValues.amperageL2MeterValue = amperagePerPhase;
        meterValues.voltageL2MeterValue = voltage;
        meterValues.powerImportMeterValue += amperagePerPhase * voltage;
      }
      if (phasesUsed.csPhase3) {
        meterValues.amperageL3MeterValue = amperagePerPhase;
        meterValues.voltageL3MeterValue = voltage;
        meterValues.powerImportMeterValue += amperagePerPhase * voltage;
      }
    }
    await chargingStationContext.sendConsumptionMeterValue(
      transaction.connectorId,
      transaction.id,
      new Date(),
      meterValues
    );
  }
}

const testData: TestData = new TestData();

const smartChargingSettings = TestData.getSmartChargingSettings();
for (const key of Object.keys(smartChargingSettings)) {
  if (!smartChargingSettings[key] || smartChargingSettings[key] === '') {
    testData.chargingSettingProvided = false;
  }
}

// Notification requests to avoid duplicated code
const chargingStationConnector1Charging: OCPPStatusNotificationRequest = {
  connectorId: 1,
  status: ChargePointStatus.CHARGING,
  errorCode: ChargePointErrorCode.NO_ERROR,
  timestamp: new Date().toISOString()
};
const chargingStationConnector2Charging: OCPPStatusNotificationRequest = {
  connectorId: 2,
  status: ChargePointStatus.CHARGING,
  errorCode: ChargePointErrorCode.NO_ERROR,
  timestamp: new Date().toISOString()
};

const chargingStationConnector1Available: OCPPStatusNotificationRequest = {
  connectorId: 1,
  status: ChargePointStatus.AVAILABLE,
  errorCode: ChargePointErrorCode.NO_ERROR,
  timestamp: new Date().toISOString()
};
const chargingStationConnector2Available: OCPPStatusNotificationRequest = {
  connectorId: 2,
  status: ChargePointStatus.AVAILABLE,
  errorCode: ChargePointErrorCode.NO_ERROR,
  timestamp: new Date().toISOString()
};

// Most common cp schedules used to validate the schedules of the returned charging profiles
const limit96 = [
  {
    'startPeriod': 0,
    'limit': 96
  },
  {
    'startPeriod': 900,
    'limit': 96
  },
  {
    'startPeriod': 1800,
    'limit': 96
  }
];

const limit32 = [
  {
    'startPeriod': 0,
    'limit': 32
  },
  {
    'startPeriod': 900,
    'limit': 32
  },
  {
    'startPeriod': 1800,
    'limit': 32
  }
];

const limitMinThreePhased = [
  {
    'startPeriod': 0,
    'limit': StaticLimitAmps.MIN_LIMIT_PER_PHASE * 3
  },
  {
    'startPeriod': 900,
    'limit': StaticLimitAmps.MIN_LIMIT_PER_PHASE * 3
  },
  {
    'startPeriod': 1800,
    'limit': StaticLimitAmps.MIN_LIMIT_PER_PHASE * 3
  }
];

const limitMinSinglePhased = [
  {
    'startPeriod': 0,
    'limit': StaticLimitAmps.MIN_LIMIT_PER_PHASE
  },
  {
    'startPeriod': 900,
    'limit': StaticLimitAmps.MIN_LIMIT_PER_PHASE
  },
  {
    'startPeriod': 1800,
    'limit': StaticLimitAmps.MIN_LIMIT_PER_PHASE
  }
];

const limit0 = [
  {
    'startPeriod': 0,
    'limit': 0
  },
  {
    'startPeriod': 900,
    'limit': 0
  },
  {
    'startPeriod': 1800,
    'limit': 0
  }
];

// Buffer Factors
let aCBufferFactor = 0;
let dCBufferFactor = 0;


// Helpers to store ongoing transactions across different tests
let transaction = {} as Transaction;
let transaction1 = {} as Transaction;
let transaction2 = {} as Transaction;

// Conditional test execution function
const describeif = (condition) => condition ? describe : describe.skip;

describeif(testData.chargingSettingProvided)('Smart Charging Service', () => {
  jest.setTimeout(1000000);

  beforeAll(async () => {
    global.database = new MongoDBStorage(config.get('storage'));
    await global.database.start();
  });

  afterAll(async () => {
    // Close DB connection
    await global.database.stop();
  });

  describe('With component SmartCharging (utsmartcharging)', () => {
    beforeAll(async () => {
      testData.tenantContext = await ContextProvider.defaultInstance.getTenantContext(ContextDefinition.TENANT_CONTEXTS.TENANT_SMART_CHARGING);
      testData.centralUserContext = testData.tenantContext.getUserContext(ContextDefinition.USER_CONTEXTS.DEFAULT_ADMIN);
      testData.userContext = testData.tenantContext.getUserContext(ContextDefinition.USER_CONTEXTS.DEFAULT_ADMIN);
      expect(testData.userContext).to.not.be.null;
      testData.centralUserService = new CentralServerService(
        testData.tenantContext.getTenant().subdomain,
        testData.centralUserContext
      );
      testData.isForcedSynchro = false;
      testData.userContext = testData.tenantContext.getUserContext(ContextDefinition.USER_CONTEXTS.DEFAULT_ADMIN);
      assert(testData.userContext, 'User context cannot be null');
      if (testData.userContext === testData.centralUserContext) {
        // Reuse the central user service (to avoid double login)
        testData.userService = testData.centralUserService;
      } else {
        testData.userService = new CentralServerService(
          testData.tenantContext.getTenant().subdomain,
          testData.userContext
        );
      }
      assert(!!testData.userService, 'User service cannot be null');
      const tenant = testData.tenantContext.getTenant();
      if (tenant.id) {
        await TestData.setSmartChargingValidCredentials(testData);
      } else {
        throw new Error(`Unable to get Tenant ID for tenant : ${ContextDefinition.TENANT_CONTEXTS.TENANT_SMART_CHARGING}`);
      }
    });

    afterAll(async () => {
      await testData.chargingStationContext.cleanUpCreatedData();
      await testData.chargingStationContext1.cleanUpCreatedData();
    });

    it('Should connect to Smart Charging Provider', async () => {
      const response = await testData.userService.smartChargingApi.testConnection({});
      expect(response.data).containSubset(Constants.REST_RESPONSE_SUCCESS);
    });

    it(
      'Should not connect to Smart Charging Provider with invalid URL',
      async () => {
        const sapSmartChargingSettings = TestData.getSmartChargingSettings();
        sapSmartChargingSettings.password = await Cypher.encrypt(testData.tenantContext.getTenant(), sapSmartChargingSettings.password);
        sapSmartChargingSettings.optimizerUrl = '';
        await TestData.saveSmartChargingSettings(testData, sapSmartChargingSettings);
        const response = await testData.userService.smartChargingApi.testConnection({});
      }
    );

    describe('Test for three phased site area (This is a sub site area of DC site area)', () => {
      beforeAll(() => {
        testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
        testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED);
        testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
        testData.chargingStationContext1 = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16 + '-' + `${ContextDefinition.SITE_CONTEXTS.SITE_BASIC}-${ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED}` + '-' + 'singlePhased');
      });

      afterAll(async () => {
        // Set Connector Status back to available
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Available);
        await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector1Available);
        await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector2Available);
      });

      it('Test for one car charging', async () => {
        // Set site area limit
        testData.siteAreaContext.getSiteArea().maximumPower = 50000;
        // Start transaction on connector 1
        const transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        // Get and store started transaction
        const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction = transactionResponse.data;
        // Set Connector Status to 'charging
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        // Call Smart Charging
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        // Validate Charging Schedule
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
      });

      it('Test for two cars charging', async () => {
        const transactionStartResponse = await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction1 = transactionResponse.data;
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
      });

      it('Test for two cars charging with lower site area limit', async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 32000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 43.1
          },
          {
            'startPeriod': 900,
            'limit': 43.1
          },
          {
            'startPeriod': 1800,
            'limit': 43.1
          }
        ]);
      });

      it(
        'Test for three cars charging with lower site area limit and one car on a single phased station',
        async () => {
          // Start transaction on single phased Charging Station
          const transactionStartResponse = await testData.chargingStationContext1.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
          const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
          transaction2 = transactionResponse.data;
          await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector1Charging);
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': 43.1
            },
            {
              'startPeriod': 900,
              'limit': 43.1
            },
            {
              'startPeriod': 1800,
              'limit': 43.1
            }
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
        }
      );

      it(
        'Test if single phased charging station is excluded from root fuse correctly',
        async () => {
          await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(), [testData.chargingStationContext1.getChargingStation().id]);
          // Get the log of the site area limitation adjustment and check the root fuse
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const siteArea = testData.siteAreaContext.getSiteArea();
          const siteAreaLimitPerPhase = Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).div(3).toNumber();
          const connectorLimit = Utils.createDecimal(Utils.getChargingStationAmperage(testData.chargingStationContext1.getChargingStation(), null, 1)).toNumber();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' + (siteAreaLimitPerPhase - connectorLimit));
          expect(log.result[0].detailedMessages).include('"fusePhase2": ' + siteAreaLimitPerPhase);
          expect(log.result[0].detailedMessages).include('"fusePhase3": ' + siteAreaLimitPerPhase);
        }
      );

      it(
        'Test for 3 single phased cars charging with lower site area limit and one car on a single phased station (meter value received)',
        async () => {
          // Send meter values for both connectors of the 3 phased stations
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 32, transaction, testData.chargingStationContext, { csPhase1: false, csPhase2: true, csPhase3: false });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 32, transaction1, testData.chargingStationContext, { csPhase1: false, csPhase2: false, csPhase3: true });
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should use the full power, because every car is charging on another phase
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
        }
      );

      it(
        'Test for sticky limit - 1 three phased and 2 single phased cars charging and one car on a single phased station',
        async () => {
          testData.siteAreaContext.getSiteArea().maximumPower = 100000;
          await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
          await testData.chargingStationContext.stopTransaction(transaction.id, testData.userContext.tags[0].id, 180, new Date());
          const transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
          const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
          transaction = transactionResponse.data;
          // Send meter values for all stations
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 24, transaction, testData.chargingStationContext, { csPhase1: true, csPhase2: true, csPhase3: true });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 13, transaction1, testData.chargingStationContext, { csPhase1: false, csPhase2: false, csPhase3: true });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 20, transaction2, testData.chargingStationContext1, { csPhase1: true, csPhase2: false, csPhase3: false });

          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values + buffer
          let chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction)
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            }
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
          chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1)
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(13 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(13 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(13 * 3 * aCBufferFactor, 1)
            }
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            }
          ]);
          // Do not save the last profile to check if this is the only one build in the upcoming test
        }
      );

      it(
        'Test if charging profiles are not returned, when they are already applied',
        async () => {
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should only contain the charging profile, which was not saved in the last run
          const chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2);
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            }
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
        }
      );


      it(
        'Test for sticky limit with different buffer value - 1 three phased and 2 single phased cars charging and one car on a single phased station',
        async () => {
          const chargingProfiles = await smartChargingIntegrationWithDifferentBufferValues.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values + buffer
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(24 * 3 * 1.05, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(24 * 3 * 1.05, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(24 * 3 * 1.05, 1)
            }
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(13 * 3 * 1.05, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(13 * 3 * 1.05, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(13 * 3 * 1.05, 1)
            }
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(20 * 1.05, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(20 * 1.05, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(20 * 1.05, 1)
            }
          ]);
        }
      );

      it(
        'Test for sticky limit disabled - 1 three phased and 2 single phased cars and one car on a single phased station',
        async () => {
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 16, transaction, testData.chargingStationContext, { csPhase1: false, csPhase2: true, csPhase3: false });
          const chargingProfiles = await smartChargingIntegrationWithoutStickyLimit.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values + buffer
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
        }
      );

      it(
        'Test for sticky limit - check if cars are able to go up again, when using the buffer',
        async () => {
          // Send meter values for all stations
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 25, transaction, testData.chargingStationContext, { csPhase1: true, csPhase2: true, csPhase3: true });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 14, transaction1, testData.chargingStationContext, { csPhase1: false, csPhase2: false, csPhase3: true });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 21, transaction2, testData.chargingStationContext1, { csPhase1: true, csPhase2: false, csPhase3: false });
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values (+ buffer)
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[0].chargingStationID);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[1].chargingStationID);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[2].chargingStationID);
        }
      );

      it(
        'Test for sticky limit - 1 three phased and 2 single phased cars charging and one car on a single phased station with no consumption on two cars',
        async () => {
          // Send meter values for all stations
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 0, transaction, testData.chargingStationContext, { csPhase1: true, csPhase2: true, csPhase3: true });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 24, transaction1, testData.chargingStationContext, { csPhase1: false, csPhase2: false, csPhase3: true });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 0, transaction2, testData.chargingStationContext1, { csPhase1: true, csPhase2: false, csPhase3: false });
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values (+ buffer)
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limitMinThreePhased);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            }
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limitMinSinglePhased);
        }
      );

      it(
        'Test if Charging Station is excluded, when transaction is not existing anymore',
        async () => {
          await testData.chargingStationContext1.stopTransaction(transaction2.id, transaction.tagID, 200, new Date);
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(chargingProfiles.length).to.be.eq(2);
          // Charging Profiles should have limits according the sent meter values (+ buffer)
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limitMinThreePhased);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(24 * 3 * aCBufferFactor, 1)
            }
          ]);
          // Check adjustment of site area limit
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const chargingStation = testData.chargingStationContext1.getChargingStation();
          const siteArea = testData.siteAreaContext.getSiteArea();
          const siteAreaLimitPerPhase = Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).div(3).toNumber();
          const connectorLimit = Utils.createDecimal(Utils.getChargingStationAmperage(chargingStation, null, transaction2.connectorId)).toNumber();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' + (siteAreaLimitPerPhase - connectorLimit));
          expect(log.result[0].detailedMessages).include('"fusePhase2": ' + siteAreaLimitPerPhase);
          expect(log.result[0].detailedMessages).include('"fusePhase3": ' + siteAreaLimitPerPhase);
        }
      );

      it(
        'Test if Charging Stations are excluded, when transactions are not existing anymore',
        async () => {
          await testData.chargingStationContext.stopTransaction(transaction.id, transaction.tagID, 200, new Date);
          await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const siteArea = testData.siteAreaContext.getSiteArea();
          const siteAreaLimitPerPhase = Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).div(3).toNumber();
          const connectorLimitSinglePhased = Utils.createDecimal(
            Utils.getChargingStationAmperage(testData.chargingStationContext1.getChargingStation(), null, transaction2.connectorId)).toNumber();
          const chargingStationLimitThreePhased = Utils.createDecimal(
            Utils.getChargingStationAmperage(testData.chargingStationContext.getChargingStation())).div(3).toNumber();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' + (siteAreaLimitPerPhase - connectorLimitSinglePhased - chargingStationLimitThreePhased));
          expect(log.result[0].detailedMessages).include('"fusePhase2": ' + (siteAreaLimitPerPhase - chargingStationLimitThreePhased));
          expect(log.result[0].detailedMessages).include('"fusePhase3": ' + (siteAreaLimitPerPhase - chargingStationLimitThreePhased));
        }
      );
    });

    describe('Test for single phased site area', () => {
      beforeAll(() => {
        testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
        testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_SINGLE_PHASED);
        testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
      });

      afterAll(async () => {
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Available);
      });

      it('Test for one car charging', async () => {
        const transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction = transactionResponse.data;
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
      });

      it(
        'Test if one charging connector is excluded from root fuse when charging station is excluded',
        async () => {
          await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(), [testData.chargingStationContext.getChargingStation().id]);
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const siteArea = testData.siteAreaContext.getSiteArea();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' +
            Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).minus(
              Utils.getChargingStationAmperage(testData.chargingStationContext.getChargingStation(), null, 1)).toNumber()
          );
        }
      );

      it('Test for two cars charging', async () => {
        const transactionStartResponse = await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction1 = transactionResponse.data;
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
      });

      it(
        'Test if both charging connectors are excluded from root fuse when charging station is excluded',
        async () => {
          await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(), [testData.chargingStationContext.getChargingStation().id]);
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const siteArea = testData.siteAreaContext.getSiteArea();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' +
            Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).minus(
              Utils.getChargingStationAmperage(testData.chargingStationContext.getChargingStation())).toNumber()
          );
        }
      );

      it('Test for two cars charging with lower site area limit', async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 10000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': Utils.roundTo(10000 / 230 - 32, 1)
          },
          {
            'startPeriod': 900,
            'limit': Utils.roundTo(10000 / 230 - 32, 1)
          },
          {
            'startPeriod': 1800,
            'limit': Utils.roundTo(10000 / 230 - 32, 1)
          }
        ]);
      });

      it(
        'Test for sticky limit - two cars charging with lower site area limit',
        async () => {
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 16, transaction, testData.chargingStationContext, { csPhase1: true, csPhase2: false, csPhase3:false });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 20, transaction1, testData.chargingStationContext, { csPhase1: true, csPhase2: false, csPhase3:false });
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          let chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction);
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(16 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(16 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(16 * aCBufferFactor, 1)
            }
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
          chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1);
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            }
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
        }
      );

      it(
        'Test for sticky limit with different buffer value - two cars charging with lower site area limit',
        async () => {
          const chargingProfiles = await smartChargingIntegrationWithDifferentBufferValues.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(16 * 1.05, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(16 * 1.05, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(16 * 1.05, 1)
            }
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(20 * 1.05, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(20 * 1.05, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(20 * 1.05, 1)
            }
          ]);
        }
      );
      it(
        'Test for sticky limit disabled - two cars charging with lower site area limit',
        async () => {
          const chargingProfiles = await smartChargingIntegrationWithoutStickyLimit.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(10000 / 230 - 32, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(10000 / 230 - 32, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(10000 / 230 - 32, 1)
            }
          ]);
        }
      );

      it(
        'Test for sticky limit - check if cars are able to go up again, when using the buffer',
        async () => {
          testData.siteAreaContext.getSiteArea().maximumPower = 100000;
          await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
          // Send meter values for all stations
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 17, transaction, testData.chargingStationContext, { csPhase1: true, csPhase2: false, csPhase3:false });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 21, transaction1, testData.chargingStationContext, { csPhase1: true, csPhase2: false, csPhase3:false });
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values (+ buffer)
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[0].chargingStationID);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[1].chargingStationID);
        }
      );

      it(
        'Test for sticky limit - two cars charging with no consumption on one car',
        async () => {
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 0, transaction, testData.chargingStationContext, { csPhase1: true, csPhase2: false, csPhase3:false });
          await TestData.sendMeterValue(Voltage.VOLTAGE_230, 20, transaction1, testData.chargingStationContext, { csPhase1: true, csPhase2: false, csPhase3:false });
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limitMinSinglePhased);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(20 * aCBufferFactor, 1)
            }
          ]);
        }
      );
    });

    describe('Test for DC site area', () => {
      beforeAll(() => {
        testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
        testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_DC);
        testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
      });

      afterAll(async () => {
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Available);
      });


      it('Test for one car charging', async () => {
        const transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction = transactionResponse.data;
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 654
          },
          {
            'startPeriod': 900,
            'limit': 654
          }
        ]);
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod[2].limit).to.be.greaterThan(250);
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod[2].limit).to.be.lessThanOrEqual(654);
      });

      it(
        'Test if whole charge point is excluded from root fuse when charging station is excluded (one connector charging)',
        async () => {
          await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(), [testData.chargingStationContext.getChargingStation().id]);
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const chargingStation = testData.chargingStationContext.getChargingStation();
          const chargePoint = chargingStation.chargePoints.find((cp) => cp.connectorIDs.includes(transaction.connectorId));
          const siteArea = testData.siteAreaContext.getSiteArea();
          const siteAreaLimitPerPhase = Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).div(3).toNumber();
          let connectorLimitPerPhase = Utils.createDecimal(Utils.getChargingStationAmperage(chargingStation)).div(3).toNumber();
          // Calculate efficiency
          connectorLimitPerPhase = Utils.createDecimal(connectorLimitPerPhase).mul(100).div(chargePoint.efficiency).toNumber();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' + (siteAreaLimitPerPhase - connectorLimitPerPhase));
          expect(log.result[0].detailedMessages).include('"fusePhase2": ' + (siteAreaLimitPerPhase - connectorLimitPerPhase));
          expect(log.result[0].detailedMessages).include('"fusePhase3": ' + (siteAreaLimitPerPhase - connectorLimitPerPhase));
        }
      );

      it('Test for two cars charging', async () => {
        const transactionStartResponse = await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        const transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction1 = transactionResponse.data;
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 327
          },
          {
            'startPeriod': 900,
            'limit': 327
          },
          {
            'startPeriod': 1800,
            'limit': 327
          }
        ]);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 327
          },
          {
            'startPeriod': 900,
            'limit': 327
          },
          {
            'startPeriod': 1800,
            'limit': 327
          }
        ]);
      });

      it(
        'Test if only charge point is excluded from root fuse when charging station is excluded (two connectors charging)',
        async () => {
          await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(), [testData.chargingStationContext.getChargingStation().id]);
          const log = await LogStorage.getLogs(testData.tenantContext.getTenant(), { actions: [ServerAction.SMART_CHARGING], search: 'currently being used' }, Constants.DB_PARAMS_SINGLE_RECORD, null);
          const chargingStation = testData.chargingStationContext.getChargingStation();
          const chargePoint = chargingStation.chargePoints.find((cp) => cp.connectorIDs.includes(transaction1.connectorId));
          const siteArea = testData.siteAreaContext.getSiteArea();
          const siteAreaLimitPerPhase = Utils.createDecimal(siteArea.maximumPower).div(siteArea.voltage).div(3).toNumber();
          let connectorLimitPerPhase = Utils.createDecimal(Utils.getChargingStationAmperage(chargingStation)).div(3).toNumber();
          // Calculate efficiency
          connectorLimitPerPhase = Utils.createDecimal(connectorLimitPerPhase).mul(100).div(chargePoint.efficiency).toNumber();
          expect(log.result[0].detailedMessages).include('"fusePhase1": ' + (siteAreaLimitPerPhase - connectorLimitPerPhase));
          expect(log.result[0].detailedMessages).include('"fusePhase2": ' + (siteAreaLimitPerPhase - connectorLimitPerPhase));
          expect(log.result[0].detailedMessages).include('"fusePhase3": ' + (siteAreaLimitPerPhase - connectorLimitPerPhase));
        }
      );

      it('Test for two cars charging with lower site area limit', async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 100000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 327
          },
          {
            'startPeriod': 900,
            'limit': 327
          },
          {
            'startPeriod': 1800,
            'limit': 327
          }
        ]);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 86
          },
          {
            'startPeriod': 900,
            'limit': 86
          },
          {
            'startPeriod': 1800,
            'limit': 86
          },
        ]);
      });

      it(
        'Test for sticky limit - two cars charging with lower site area limit',
        async () => {
          await TestData.sendMeterValue(Voltage.VOLTAGE_400, 100, transaction, testData.chargingStationContext);
          await TestData.sendMeterValue(Voltage.VOLTAGE_400, 75, transaction1, testData.chargingStationContext);
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          let chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction)
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo((40000 / Voltage.VOLTAGE_230 / 3 * dCBufferFactor) * 3, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo((40000 / Voltage.VOLTAGE_230 / 3 * dCBufferFactor) * 3, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo((40000 / Voltage.VOLTAGE_230 / 3 * dCBufferFactor) * 3, 1)
            },
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
          chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1)
          expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo((30000 / Voltage.VOLTAGE_230 / 3 * dCBufferFactor) * 3, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo((30000 / Voltage.VOLTAGE_230 / 3 * dCBufferFactor) * 3, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo((30000 / Voltage.VOLTAGE_230 / 3 * dCBufferFactor) * 3, 1)
            }
          ]);
          await ChargingStationStorage.saveChargingProfile(testData.tenantContext.getTenant(), chargingProfile);
        }
      );

      it(
        'Test for sticky limit with different buffer value - two cars charging with lower site area limit',
        async () => {
          const chargingProfiles = await smartChargingIntegrationWithDifferentBufferValues.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(40000 / Voltage.VOLTAGE_230 * 1.1, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(40000 / Voltage.VOLTAGE_230 * 1.1, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(40000 / Voltage.VOLTAGE_230 * 1.1, 1)
            },
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': Utils.roundTo(30000 / Voltage.VOLTAGE_230 * 1.1, 1)
            },
            {
              'startPeriod': 900,
              'limit': Utils.roundTo(30000 / Voltage.VOLTAGE_230 * 1.1, 1)
            },
            {
              'startPeriod': 1800,
              'limit': Utils.roundTo(30000 / Voltage.VOLTAGE_230 * 1.1, 1)
            }
          ]);
        }
      );

      it(
        'Test for sticky limit disabled - two cars charging with lower site area limit',
        async () => {
          const chargingProfiles = await smartChargingIntegrationWithoutStickyLimit.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': 327
            },
            {
              'startPeriod': 900,
              'limit': 327
            },
            {
              'startPeriod': 1800,
              'limit': 327
            }
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': 86
            },
            {
              'startPeriod': 900,
              'limit': 86
            },
            {
              'startPeriod': 1800,
              'limit': 86
            },
          ]);
        }
      );
      it(
        'Test for sticky limit - check if cars are able to go up again, when using the buffer',
        async () => {
          testData.siteAreaContext.getSiteArea().maximumPower = 200000;
          await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
          // Send meter values for all stations
          await TestData.sendMeterValue(Voltage.VOLTAGE_400, 110, transaction, testData.chargingStationContext);
          await TestData.sendMeterValue(Voltage.VOLTAGE_400, 80, transaction1, testData.chargingStationContext);
          const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
          // Charging Profiles should have limits according the sent meter values (+ buffer)
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': 327
            },
            {
              'startPeriod': 900,
              'limit': 327
            },
            {
              'startPeriod': 1800,
              'limit': 327
            },
          ]);
          expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
            {
              'startPeriod': 0,
              'limit': 327
            },
            {
              'startPeriod': 900,
              'limit': 327
            },
            {
              'startPeriod': 1800,
              'limit': 327
            },
          ]);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[0].chargingStationID);
          await ChargingStationStorage.deleteChargingProfiles(testData.tenantContext.getTenant(), chargingProfiles[1].chargingStationID);
        }
      );
    });
  });

  describe('Test for Site Area Tree (Three phased site area is child of DC Site Area)', () => {
    beforeAll(() => {
      testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
      testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_DC);
      testData.siteAreaContext1 = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED);
      testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
      testData.chargingStationContext1 = testData.siteAreaContext1.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
      testData.chargingStationContext2 = testData.siteAreaContext1.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16 + '-' + `${ContextDefinition.SITE_CONTEXTS.SITE_BASIC}-${ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED}` + '-' + 'singlePhased');
    });

    afterAll(async () => {
      chargingStationConnector1Available.timestamp = new Date().toISOString();
      chargingStationConnector2Available.timestamp = new Date().toISOString();
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Available);
      await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector1Available);
      await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector2Available);
      await testData.chargingStationContext2.setConnectorStatus(chargingStationConnector1Available);
      await testData.chargingStationContext2.setConnectorStatus(chargingStationConnector2Available);
      testData.siteAreaContext.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.siteAreaContext1.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
    });

    it('Check for three cars charging on different site areas if enough power is available', async () => {
      testData.siteAreaContext.getSiteArea().maximumPower = 250000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.siteAreaContext1.getSiteArea().maximumPower = 50000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
      let transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
      let transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
      transaction = transactionResponse.data;
      transactionStartResponse = await testData.chargingStationContext1.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
      transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
      transaction1 = transactionResponse.data;
      transactionStartResponse = await testData.chargingStationContext2.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
      transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
      transaction2 = transactionResponse.data;
      chargingStationConnector1Charging.timestamp = new Date().toISOString();
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
      await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector1Charging);
      await testData.chargingStationContext2.setConnectorStatus(chargingStationConnector1Charging);
      const chargingProfiles = await smartChargingIntegrationWithoutPriorities.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
      expect(chargingProfiles.length).to.be.eq(3);
      expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
        {
          'startPeriod': 0,
          'limit': 654
        },
        {
          'startPeriod': 900,
          'limit': 654
        },
        {
          'startPeriod': 1800,
          'limit': 654
        }
      ]);
      expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
      expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
    });

    it('Check for three cars charging on different site areas if not enough power is available on root site area', async () => {
      testData.siteAreaContext.getSiteArea().maximumPower = 100000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      const chargingProfiles = await smartChargingIntegrationWithoutPriorities.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
      expect(chargingProfiles.length).to.be.eq(3);
      expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset([
        {
          'startPeriod': 0,
          'limit': 230.6
        },
        {
          'startPeriod': 900,
          'limit': 230.6
        },
        {
          'startPeriod': 1800,
          'limit': 230.6
        }
      ]);
      expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
      expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
    });

    it('Check for three cars charging on different site areas if not enough power is available on sub site area', async () => {
      testData.siteAreaContext1.getSiteArea().maximumPower = 30000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
      await TestData.sendMeterValue(Voltage.VOLTAGE_230, 32, transaction2, testData.chargingStationContext2, { csPhase1: true, csPhase2: true, csPhase3: true });
      const chargingProfiles = await smartChargingIntegrationWithoutPriorities.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
      expect(chargingProfiles.length).to.be.eq(3);
      let chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction);
      expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
        {
          'startPeriod': 0,
          'limit': 289.1
        },
        {
          'startPeriod': 900,
          'limit': 289.1
        },
        {
          'startPeriod': 1800,
          'limit': 289.1
        }
      ]);
      chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1);
      expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset([
        {
          'startPeriod': 0,
          'limit': 34.4
        },
        {
          'startPeriod': 900,
          'limit': 34.4
        },
        {
          'startPeriod': 1800,
          'limit': 34.4
        }
      ]);
      chargingProfile = TestData.validateAndReturnChargingProfile(chargingProfiles, transaction2);
      expect(chargingProfile.profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit32);
    });
  });

  describe('Test limit adjustments, when charging stations are excluded', () => {
    beforeAll(() => {
      testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
      testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED);
      testData.siteAreaContext1 = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_DC);
      testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
      testData.chargingStationContext1 = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16 + '-' + `${ContextDefinition.SITE_CONTEXTS.SITE_BASIC}-${ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED}` + '-' + 'singlePhased');
    });

    afterAll(async () => {
      chargingStationConnector1Available.timestamp = new Date().toISOString();
      chargingStationConnector2Available.timestamp = new Date().toISOString();
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Available);
      await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector1Available);
      await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector2Available);
      // Reset modifications on siteArea
      testData.siteAreaContext.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.siteAreaContext1.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
    });

    it('Check if one charging connector of three phased charging station will be excluded from smart charging on three phased site area', async () => {
      testData.siteAreaContext.getSiteArea().maximumPower = 22080 +
      Utils.createDecimal(limitMinThreePhased[0].limit).mul(testData.siteAreaContext.getSiteArea().voltage).toNumber() ;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
      await testData.chargingStationContext1.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
      chargingStationConnector1Charging.timestamp = new Date().toISOString();
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
      await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector1Charging);
      const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(),
        [testData.chargingStationContext.getChargingStation().id]);
      expect(chargingProfiles.length).to.be.eq(1);
      expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limitMinSinglePhased);
    });

    it(
      'Check if one charging connector of single phased station will be excluded only on one phase on three phased site area',
      async () => {
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(),
          [testData.chargingStationContext1.getChargingStation().id]);
        expect(chargingProfiles.length).to.be.eq(1);
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limitMinThreePhased);
      }
    );

    it(
      'Check if two charging connectors of three phased charging station will be excluded only on one phase on three phased site area',
      async () => {
        await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        chargingStationConnector2Charging.timestamp = new Date().toISOString();
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(),
          [testData.chargingStationContext.getChargingStation().id]);
        expect(chargingProfiles.length).to.be.eq(1);
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
      }
    );

    it(
      'Check if two charging connectors of single phased charging station will be excluded only on one phase on three phased site area',
      async () => {
        await testData.chargingStationContext1.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        chargingStationConnector2Charging.timestamp = new Date().toISOString();
        await testData.chargingStationContext1.setConnectorStatus(chargingStationConnector2Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(),
          [testData.chargingStationContext1.getChargingStation().id]);
        expect(chargingProfiles.length).to.be.eq(2);
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
        expect(chargingProfiles[1].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
      }
    );

    it(
      'Check if two charging connectors will be excluded also on parent site area level',
      async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 100000;
        testData.siteAreaContext1.getSiteArea().maximumPower = 22080 +
        Utils.createDecimal(limitMinThreePhased[0].limit).mul(testData.siteAreaContext.getSiteArea().voltage).toNumber();
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea(),
          [testData.chargingStationContext1.getChargingStation().id]);
        expect(chargingProfiles.length).to.be.eq(2);
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
        expect(chargingProfiles[1].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
      }
    );
  });

  describe('Test for Asset management', () => {
    beforeAll(async () => {
      testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
      testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED);
      testData.siteAreaContext1 = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_DC);
      testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
      testData.newAsset = {
        id: '601d381a8bcb0639a4bfaca2',
        name :  'Building',
        siteAreaID :  testData.siteAreaContext.getSiteArea().id as string,
        assetType :  AssetType.CONSUMPTION,
        fluctuationPercent : 10,
        staticValueWatt : 100000,
        connectionID :  null,
        dynamicAsset : true,
        issuer: true,
        currentInstantWatts: 70000,
        values: [],
        coordinates: [],
        lastConsumption: {
          timestamp: new Date()
        }
      } as Asset;
      // Create Assets
      await AssetStorage.saveAsset(testData.tenantContext.getTenant(), testData.newAsset);
    });

    afterAll(async () => {
      chargingStationConnector1Available.timestamp = new Date().toISOString();
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);

      // Reset modifications on siteArea
      testData.siteAreaContext.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.siteAreaContext1.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());

      await AssetStorage.deleteAsset(testData.tenantContext.getTenant(), testData.newAsset.id);
    });


    it(
      'Check if charging station is limited with consumption from building',
      async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 100000;
        testData.siteAreaContext.getSiteArea().smartCharging = true;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        chargingStationConnector1Charging.timestamp = new Date().toISOString();
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 87
          },
          {
            'startPeriod': 900,
            'limit': 87
          },
          {
            'startPeriod': 1800,
            'limit': 87
          },
        ]);
      }
    );

    it(
      'Check if parent site area is limited with building consumption on sub site area  ',
      async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 200000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        testData.siteAreaContext1.getSiteArea().maximumPower = 100000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
        await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        chargingStationConnector1Charging.timestamp = new Date().toISOString();
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 87
          },
          {
            'startPeriod': 900,
            'limit': 87
          },
          {
            'startPeriod': 1800,
            'limit': 87
          },
        ]);
      }
    );

    it(
      'Check if charging station is limited with backup value from building',
      async () => {
        testData.newAsset.lastConsumption = { timestamp: new Date('2021-02-05T14:16:19.001Z'), value: 0 };
        testData.siteAreaContext.getSiteArea().maximumPower = 120000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        testData.siteAreaContext1.getSiteArea().maximumPower = 200000;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
        await AssetStorage.saveAsset(testData.tenantContext.getTenant(), testData.newAsset);
        await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        chargingStationConnector1Charging.timestamp = new Date().toISOString();
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset([
          {
            'startPeriod': 0,
            'limit': 87
          },
          {
            'startPeriod': 900,
            'limit': 87
          },
          {
            'startPeriod': 1800,
            'limit': 87
          },
        ]);
      }
    );

    it('Check if Asset is ignored when excluded', async () => {
      testData.siteAreaContext.getSiteArea().maximumPower = 22080;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.newAsset.excludeFromSmartCharging = true;
      await AssetStorage.saveAsset(testData.tenantContext.getTenant(), testData.newAsset);
      const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
      expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
    });

    it('Check if solar panel production is added to capacity', async () => {
      testData.siteAreaContext.getSiteArea().maximumPower = 1;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.newAsset.name = 'Solar Panel';
      testData.newAsset.currentInstantWatts = -44999;
      testData.newAsset.staticValueWatt = 50000,
      testData.newAsset.fluctuationPercent = 50;
      testData.newAsset.assetType = AssetType.PRODUCTION;
      testData.newAsset.excludeFromSmartCharging = false;
      testData.newAsset.lastConsumption = { timestamp: new Date(), value: 0 };
      await AssetStorage.saveAsset(testData.tenantContext.getTenant(), testData.newAsset);
      const chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
      expect(chargingProfiles[0].profile.chargingSchedule.chargingSchedulePeriod).containSubset([
        {
          'startPeriod': 0,
          'limit': 87
        },
        {
          'startPeriod': 900,
          'limit': 87
        },
        {
          'startPeriod': 1800,
          'limit': 87
        },
      ]);
    });
  });

  describe('Test for Priorities', () => {
    beforeAll(async () => {
      testData.siteContext = testData.tenantContext.getSiteContext(ContextDefinition.SITE_CONTEXTS.SITE_BASIC);
      testData.siteAreaContext = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_THREE_PHASED);
      testData.siteAreaContext1 = testData.siteContext.getSiteAreaContext(ContextDefinition.SITE_AREA_CONTEXTS.WITH_SMART_CHARGING_DC);
      testData.chargingStationContext = testData.siteAreaContext.getChargingStationContext(ContextDefinition.CHARGING_STATION_CONTEXTS.ASSIGNED_OCPP16);
    });

    afterAll(async () => {
      await testData.chargingStationContext.stopTransaction(transaction.id, testData.userContext.tags[0].id, 180, new Date());
      await testData.chargingStationContext.stopTransaction(transaction1.id, testData.userContext.tags[0].id, 180, new Date());


      chargingStationConnector1Available.timestamp = new Date().toISOString();
      chargingStationConnector2Available.timestamp = new Date().toISOString();
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Available);
      await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Available);

      // Reset modifications on siteArea
      testData.siteAreaContext.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
      testData.siteAreaContext1.getSiteArea().maximumPower = 200000;
      await testData.userService.siteAreaApi.update(testData.siteAreaContext1.getSiteArea());
    });


    it(
      'Check if session with earlier departure time is prioritized',
      async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 22080;
        testData.siteAreaContext.getSiteArea().smartCharging = true;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        let transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        let transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction = transactionResponse.data;

        transactionStartResponse = await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction1 = transactionResponse.data;
        chargingStationConnector1Charging.timestamp = new Date().toISOString();
        chargingStationConnector2Charging.timestamp = new Date().toISOString();

        transaction.departureTime = moment(transaction.timestamp).add(8, 'hours').toDate();
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction);
        transaction1.departureTime = moment(transaction.timestamp).add(4, 'hours').toDate();
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction1);

        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);

        let chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);

        // Switch the priorities
        transaction.departureTime = moment(transaction.timestamp).add(4, 'hours').toDate();
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction);
        transaction1.departureTime = moment(transaction.timestamp).add(8, 'hours').toDate();
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction1);

        chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
      }
    );

    it(
      'Check if session with less SOC is prioritized',
      async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 22080;
        testData.siteAreaContext.getSiteArea().smartCharging = true;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        let transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        let transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction = transactionResponse.data;

        transactionStartResponse = await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction1 = transactionResponse.data;
        chargingStationConnector1Charging.timestamp = new Date().toISOString();
        chargingStationConnector2Charging.timestamp = new Date().toISOString();

        transaction.carStateOfCharge = 20;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction);
        transaction1.stateOfCharge = 40;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction1);

        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);

        let chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);

        transaction.carStateOfCharge = 40;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction);
        transaction1.stateOfCharge = 20;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction1);

        chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
      }
    );

    it(
      'Check if session with higher target SOC is prioritized',
      async () => {
        testData.siteAreaContext.getSiteArea().maximumPower = 22080;
        testData.siteAreaContext.getSiteArea().smartCharging = true;
        await testData.userService.siteAreaApi.update(testData.siteAreaContext.getSiteArea());
        let transactionStartResponse = await testData.chargingStationContext.startTransaction(1, testData.userContext.tags[0].id, 180, new Date);
        let transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction = transactionResponse.data;

        transactionStartResponse = await testData.chargingStationContext.startTransaction(2, testData.userContext.tags[0].id, 180, new Date);
        transactionResponse = await testData.centralUserService.transactionApi.readById(transactionStartResponse.transactionId);
        transaction1 = transactionResponse.data;
        chargingStationConnector1Charging.timestamp = new Date().toISOString();
        chargingStationConnector2Charging.timestamp = new Date().toISOString();

        transaction.targetStateOfCharge = 40;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction);
        transaction1.targetStateOfCharge = 20;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction1);

        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector1Charging);
        await testData.chargingStationContext.setConnectorStatus(chargingStationConnector2Charging);

        let chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);

        transaction.targetStateOfCharge = 20;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction);
        transaction1.targetStateOfCharge = 40;
        await TransactionStorage.saveTransaction(testData.tenantContext.getTenant(), transaction1);

        chargingProfiles = await smartChargingIntegration.buildChargingProfiles(testData.siteAreaContext.getSiteArea());
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit0);
        expect(TestData.validateAndReturnChargingProfile(chargingProfiles, transaction1).profile.chargingSchedule.chargingSchedulePeriod).containSubset(limit96);
      }
    );
  });
});
