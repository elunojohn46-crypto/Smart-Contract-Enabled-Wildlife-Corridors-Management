import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface CorridorDetails {
  name: string;
  description: string;
  boundaries: string[]; // Geo-coordinates as strings
  creator: string;
  timestamp: number;
  status: string;
  visibility: boolean;
}

interface Parcels {
  parcels: number[]; // Land parcel IDs
}

interface Tags {
  tags: string[];
}

interface Version {
  changes: string;
  timestamp: number;
  updater: string;
}

interface Collaborator {
  role: string;
  permissions: string[];
  addedAt: number;
}

interface StatusHistory {
  oldStatus: string;
  newStatus: string;
  timestamp: number;
  changer: string;
}

interface ContractState {
  corridors: Map<number, CorridorDetails>;
  corridorParcels: Map<number, Parcels>;
  corridorTags: Map<number, Tags>;
  corridorVersions: Map<string, Version>; // Key as `${corridorId}-${version}`
  corridorCollaborators: Map<string, Collaborator>; // Key as `${corridorId}-${collaborator}`
  corridorStatusHistory: Map<string, StatusHistory>; // Key as `${corridorId}-${changeId}`
  contractOwner: string;
  paused: boolean;
  corridorCounter: number;
}

// Mock contract implementation
class CorridorRegistryMock {
  private state: ContractState = {
    corridors: new Map(),
    corridorParcels: new Map(),
    corridorTags: new Map(),
    corridorVersions: new Map(),
    corridorCollaborators: new Map(),
    corridorStatusHistory: new Map(),
    contractOwner: "deployer",
    paused: false,
    corridorCounter: 0,
  };

  private ERR_CORRIDOR_EXISTS = 1;
  private ERR_NOT_OWNER = 2;
  private ERR_INVALID_BOUNDARIES = 3;
  private ERR_INVALID_ID = 4;
  private ERR_NOT_AUTHORIZED = 5;
  private ERR_MAX_PARCELS_REACHED = 6;
  private ERR_INVALID_STATUS = 7;
  private ERR_VERSION_EXISTS = 8;
  private ERR_INVALID_VERSION = 9;
  private ERR_MAX_TAGS = 10;
  private ERR_INVALID_PRINCIPAL = 11;
  private ERR_PAUSED = 12;
  private MAX_BOUNDARIES_LEN = 100;
  private MAX_PARCELS = 50;
  private MAX_TAGS = 20;
  private MAX_COLLABORATORS = 10;

  private incrementCounter(): number {
    const current = this.state.corridorCounter;
    this.state.corridorCounter += 1;
    return current + 1;
  }

  private validateBoundaries(boundaries: string[]): boolean {
    return boundaries.length > 0 && boundaries.length <= this.MAX_BOUNDARIES_LEN;
  }

  private validateParcels(parcels: number[]): boolean {
    return parcels.length <= this.MAX_PARCELS;
  }

  private validateTags(tags: string[]): boolean {
    return tags.length <= this.MAX_TAGS;
  }

  private isContractOwner(caller: string): boolean {
    return caller === this.state.contractOwner;
  }

  private isCorridorOwner(corridorId: number, caller: string): boolean {
    const entry = this.state.corridors.get(corridorId);
    return !!entry && entry.creator === caller;
  }

  registerCorridor(
    caller: string,
    name: string,
    description: string,
    boundaries: string[],
    initialParcels: number[],
    tags: string[],
    status: string,
    visibility: boolean
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.validateBoundaries(boundaries)) {
      return { ok: false, value: this.ERR_INVALID_BOUNDARIES };
    }
    if (!this.validateParcels(initialParcels)) {
      return { ok: false, value: this.ERR_MAX_PARCELS_REACHED };
    }
    if (!this.validateTags(tags)) {
      return { ok: false, value: this.ERR_MAX_TAGS };
    }
    if (!["proposed", "active"].includes(status)) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    // Simplified duplicate check by name
    for (const entry of this.state.corridors.values()) {
      if (entry.name === name) {
        return { ok: false, value: this.ERR_CORRIDOR_EXISTS };
      }
    }
    const newId = this.incrementCounter();
    this.state.corridors.set(newId, {
      name,
      description,
      boundaries,
      creator: caller,
      timestamp: Date.now(),
      status,
      visibility,
    });
    this.state.corridorParcels.set(newId, { parcels: initialParcels });
    this.state.corridorTags.set(newId, { tags });
    return { ok: true, value: newId };
  }

  updateCorridorDescription(
    caller: string,
    corridorId: number,
    newDescription: string,
    version: number,
    changes: string
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isCorridorOwner(corridorId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const entry = this.state.corridors.get(corridorId);
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    const versionKey = `${corridorId}-${version}`;
    if (this.state.corridorVersions.has(versionKey)) {
      return { ok: false, value: this.ERR_VERSION_EXISTS };
    }
    entry.description = newDescription;
    this.state.corridorVersions.set(versionKey, {
      changes,
      timestamp: Date.now(),
      updater: caller,
    });
    return { ok: true, value: true };
  }

  addParcelToCorridor(
    caller: string,
    corridorId: number,
    parcelId: number
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isCorridorOwner(corridorId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const entry = this.state.corridorParcels.get(corridorId);
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    if (entry.parcels.length >= this.MAX_PARCELS) {
      return { ok: false, value: this.ERR_MAX_PARCELS_REACHED };
    }
    if (entry.parcels.includes(parcelId)) {
      return { ok: false, value: this.ERR_CORRIDOR_EXISTS };
    }
    entry.parcels.push(parcelId);
    return { ok: true, value: true };
  }

  updateStatus(
    caller: string,
    corridorId: number,
    newStatus: string,
    changeId: number
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isCorridorOwner(corridorId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (!["active", "archived", "proposed"].includes(newStatus)) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    const entry = this.state.corridors.get(corridorId);
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    const oldStatus = entry.status;
    entry.status = newStatus;
    const historyKey = `${corridorId}-${changeId}`;
    this.state.corridorStatusHistory.set(historyKey, {
      oldStatus,
      newStatus,
      timestamp: Date.now(),
      changer: caller,
    });
    return { ok: true, value: true };
  }

  addCollaborator(
    caller: string,
    corridorId: number,
    collaborator: string,
    role: string,
    permissions: string[]
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isCorridorOwner(corridorId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (collaborator === caller) {
      return { ok: false, value: this.ERR_INVALID_PRINCIPAL };
    }
    const entry = this.state.corridors.get(corridorId);
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    const collabKey = `${corridorId}-${collaborator}`;
    if (this.state.corridorCollaborators.has(collabKey)) {
      return { ok: false, value: this.ERR_CORRIDOR_EXISTS };
    }
    this.state.corridorCollaborators.set(collabKey, {
      role,
      permissions,
      addedAt: Date.now(),
    });
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.isContractOwner(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.isContractOwner(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  transferOwnership(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (!this.isContractOwner(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }

  getCorridorDetails(corridorId: number): ClarityResponse<CorridorDetails | null> {
    return { ok: true, value: this.state.corridors.get(corridorId) ?? null };
  }

  getCorridorParcels(corridorId: number): ClarityResponse<Parcels | null> {
    return { ok: true, value: this.state.corridorParcels.get(corridorId) ?? null };
  }

  getCorridorTags(corridorId: number): ClarityResponse<Tags | null> {
    return { ok: true, value: this.state.corridorTags.get(corridorId) ?? null };
  }

  getCorridorVersion(corridorId: number, version: number): ClarityResponse<Version | null> {
    const key = `${corridorId}-${version}`;
    return { ok: true, value: this.state.corridorVersions.get(key) ?? null };
  }

  getCorridorCollaborator(corridorId: number, collaborator: string): ClarityResponse<Collaborator | null> {
    const key = `${corridorId}-${collaborator}`;
    return { ok: true, value: this.state.corridorCollaborators.get(key) ?? null };
  }

  getStatusHistory(corridorId: number, changeId: number): ClarityResponse<StatusHistory | null> {
    const key = `${corridorId}-${changeId}`;
    return { ok: true, value: this.state.corridorStatusHistory.get(key) ?? null };
  }

  getContractOwner(): ClarityResponse<string> {
    return { ok: true, value: this.state.contractOwner };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getCorridorCount(): ClarityResponse<number> {
    return { ok: true, value: this.state.corridorCounter };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  owner: "wallet_1",
  collaborator: "wallet_2",
  unauthorized: "wallet_3",
};

describe("CorridorRegistry Contract", () => {
  let contract: CorridorRegistryMock;

  beforeEach(() => {
    contract = new CorridorRegistryMock();
    vi.resetAllMocks();
  });

  it("should allow registering a new corridor", () => {
    const result = contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1", "lat2,long2"],
      [1, 2],
      ["tag1", "tag2"],
      "proposed",
      true
    );
    expect(result).toEqual({ ok: true, value: 1 });
    const details = contract.getCorridorDetails(1);
    expect(details).toEqual({
      ok: true,
      value: expect.objectContaining({
        name: "Test Corridor",
        description: "Description",
        boundaries: ["lat1,long1", "lat2,long2"],
        creator: accounts.owner,
        status: "proposed",
        visibility: true,
      }),
    });
    const parcels = contract.getCorridorParcels(1);
    expect(parcels).toEqual({ ok: true, value: { parcels: [1, 2] } });
    const tags = contract.getCorridorTags(1);
    expect(tags).toEqual({ ok: true, value: { tags: ["tag1", "tag2"] } });
  });

  it("should prevent duplicate corridor by name", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1"],
      [],
      [],
      "proposed",
      true
    );
    const duplicate = contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Another",
      ["lat3,long3"],
      [],
      [],
      "proposed",
      true
    );
    expect(duplicate).toEqual({ ok: false, value: 1 });
  });

  it("should allow updating corridor description with version", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Old Description",
      ["lat1,long1"],
      [],
      [],
      "proposed",
      true
    );
    const update = contract.updateCorridorDescription(
      accounts.owner,
      1,
      "New Description",
      1,
      "Updated desc"
    );
    expect(update).toEqual({ ok: true, value: true });
    const details = contract.getCorridorDetails(1);
    expect(details.value?.description).toBe("New Description");
    const version = contract.getCorridorVersion(1, 1);
    expect(version).toEqual({
      ok: true,
      value: expect.objectContaining({ changes: "Updated desc", updater: accounts.owner }),
    });
  });

  it("should prevent non-owner from updating description", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1"],
      [],
      [],
      "proposed",
      true
    );
    const update = contract.updateCorridorDescription(
      accounts.unauthorized,
      1,
      "New",
      1,
      "Changes"
    );
    expect(update).toEqual({ ok: false, value: 2 });
  });

  it("should allow adding parcel to corridor", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1"],
      [1],
      [],
      "proposed",
      true
    );
    const add = contract.addParcelToCorridor(accounts.owner, 1, 3);
    expect(add).toEqual({ ok: true, value: true });
    const parcels = contract.getCorridorParcels(1);
    expect(parcels.value?.parcels).toEqual([1, 3]);
  });

  it("should prevent adding duplicate parcel", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1"],
      [1],
      [],
      "proposed",
      true
    );
    const add = contract.addParcelToCorridor(accounts.owner, 1, 1);
    expect(add).toEqual({ ok: false, value: 1 });
  });

  it("should allow updating status with history", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1"],
      [],
      [],
      "proposed",
      true
    );
    const update = contract.updateStatus(accounts.owner, 1, "active", 1);
    expect(update).toEqual({ ok: true, value: true });
    const details = contract.getCorridorDetails(1);
    expect(details.value?.status).toBe("active");
    const history = contract.getStatusHistory(1, 1);
    expect(history).toEqual({
      ok: true,
      value: expect.objectContaining({
        oldStatus: "proposed",
        newStatus: "active",
        changer: accounts.owner,
      }),
    });
  });

  it("should allow adding collaborator", () => {
    contract.registerCorridor(
      accounts.owner,
      "Test Corridor",
      "Description",
      ["lat1,long1"],
      [],
      [],
      "proposed",
      true
    );
    const add = contract.addCollaborator(
      accounts.owner,
      1,
      accounts.collaborator,
      "monitor",
      ["update", "view"]
    );
    expect(add).toEqual({ ok: true, value: true });
    const collab = contract.getCorridorCollaborator(1, accounts.collaborator);
    expect(collab).toEqual({
      ok: true,
      value: expect.objectContaining({
        role: "monitor",
        permissions: ["update", "view"],
      }),
    });
  });

  it("should pause and unpause contract", () => {
    const pause = contract.pauseContract(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const registerDuringPause = contract.registerCorridor(
      accounts.owner,
      "Test",
      "Desc",
      ["lat1,long1"],
      [],
      [],
      "proposed",
      true
    );
    expect(registerDuringPause).toEqual({ ok: false, value: 12 });

    const unpause = contract.unpauseContract(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should transfer contract ownership", () => {
    const transfer = contract.transferOwnership(accounts.deployer, accounts.owner);
    expect(transfer).toEqual({ ok: true, value: true });
    expect(contract.getContractOwner()).toEqual({ ok: true, value: accounts.owner });
  });

  it("should prevent unauthorized pause", () => {
    const pause = contract.pauseContract(accounts.unauthorized);
    expect(pause).toEqual({ ok: false, value: 5 });
  });
});