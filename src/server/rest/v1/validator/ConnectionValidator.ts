import { HttpConnectionRequest, HttpConnectionsRequest } from '../../../../types/requests/HttpConnectionRequest';

import Connection from '../../../../types/Connection';
import Schema from '../../../../types/validator/Schema';
import SchemaValidator from './SchemaValidator';
import fs from 'fs';
import global from '../../../../types/GlobalType';

export default class ConnectionValidator extends SchemaValidator {
  private static instance: ConnectionValidator|null = null;
  private connectionCreation: Schema;
  private connectionsGet: Schema;
  private connectionGet: Schema;

  private constructor() {
    super('ConnectionValidator');
    this.connectionCreation = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/connections/connection-create.json`, 'utf8'));
    this.connectionsGet = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/connections/connections-get.json`, 'utf8'));
    this.connectionGet = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/connections/connection-get.json`, 'utf8'));
  }

  public static getInstance(): ConnectionValidator {
    if (!ConnectionValidator.instance) {
      ConnectionValidator.instance = new ConnectionValidator();
    }
    return ConnectionValidator.instance;
  }

  validateConnectionCreation(content: any): Connection {
    this.validate(this.connectionCreation, content);
    return content;
  }

  validateConnectionsGet(content: any): HttpConnectionsRequest {
    this.validate(this.connectionsGet, content);
    return content;
  }

  validateConnectionGet(content: any): HttpConnectionRequest {
    this.validate(this.connectionGet, content);
    return content;
  }
}

