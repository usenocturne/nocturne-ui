const NO_DEVICE_PRESET_SCOPE = "no-device";

const MAIN_BUTTON_PRESET_KEY = "nocturne_presets";
const OLD_MAIN_BUTTON_PRESET_KEY = "nocturne_button_presets";
const MAIN_BUTTON_LEGACY_MIGRATION_KEY =
  "nocturne_presets_button_legacy_migrated_to_device";
const OLD_MAIN_BUTTON_LEGACY_MIGRATION_KEY =
  "nocturne_button_presets_legacy_migrated_to_device";
const MAIN_BUTTON_FIELDS = ["Id", "Type", "Image", "Name", "Tracks"];
const MAIN_BUTTON_FIELD_TO_PROPERTY = {
  Id: "id",
  Type: "type",
  Image: "image",
  Name: "name",
  Tracks: "tracks",
};
const MAIN_BUTTON_NUMBERS = [1, 2, 3, 4];

const MOCKINGBIRD_PRESETS_KEY = "mockingbird_presets";
const OLD_MOCKINGBIRD_PRESETS_KEY = "nocturne_presets";
const MOCKINGBIRD_LEGACY_MIGRATION_KEY =
  "mockingbird_presets_legacy_migrated_to_device";
const OLD_MOCKINGBIRD_LEGACY_MIGRATION_KEY =
  "nocturne_presets_legacy_migrated_to_device";

const getStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const normalizePresetDeviceId = (deviceId) => {
  if (typeof deviceId !== "string") return NO_DEVICE_PRESET_SCOPE;

  const normalized = deviceId.trim().toLowerCase();
  return normalized || NO_DEVICE_PRESET_SCOPE;
};

export const getActivePresetDeviceId = () => {
  const storage = getStorage();
  return normalizePresetDeviceId(
    storage?.getItem("lastConnectedBluetoothDevice"),
  );
};

export const getDevicePresetStorageKey = (
  baseKey,
  deviceId = getActivePresetDeviceId(),
) => `${baseKey}:${normalizePresetDeviceId(deviceId)}`;

const getEncodedDevicePresetStorageKey = (
  baseKey,
  deviceId = getActivePresetDeviceId(),
) => `${baseKey}:${encodeURIComponent(normalizePresetDeviceId(deviceId))}`;

const getDevicePresetStorageKeys = (baseKey, deviceId) => {
  const rawKey = getDevicePresetStorageKey(baseKey, deviceId);
  const encodedKey = getEncodedDevicePresetStorageKey(baseKey, deviceId);
  return rawKey === encodedKey ? [rawKey] : [rawKey, encodedKey];
};

const migrateEncodedDeviceStorageKey = (storage, baseKey, deviceId) => {
  const rawKey = getDevicePresetStorageKey(baseKey, deviceId);
  const encodedKey = getEncodedDevicePresetStorageKey(baseKey, deviceId);

  if (rawKey === encodedKey) return;

  const encodedValue = storage.getItem(encodedKey);
  if (encodedValue === null) return;

  if (storage.getItem(rawKey) === null) {
    storage.setItem(rawKey, encodedValue);
  }

  storage.removeItem(encodedKey);
};

const getButtonMappingsStorageKey = (deviceId = getActivePresetDeviceId()) =>
  getDevicePresetStorageKey(MAIN_BUTTON_PRESET_KEY, deviceId);

const getScopedFieldButtonMappingStorageKey = (
  baseKey,
  buttonNumber,
  field,
  deviceId = getActivePresetDeviceId(),
) =>
  `${baseKey}:${normalizePresetDeviceId(
    deviceId,
  )}:button${buttonNumber}${field}`;

const getEncodedScopedFieldButtonMappingStorageKey = (
  baseKey,
  buttonNumber,
  field,
  deviceId = getActivePresetDeviceId(),
) =>
  `${baseKey}:${encodeURIComponent(
    normalizePresetDeviceId(deviceId),
  )}:button${buttonNumber}${field}`;

const getLegacyButtonMappingStorageKey = (buttonNumber, field) =>
  `button${buttonNumber}${field}`;

const createEmptyButtonMappings = () => MAIN_BUTTON_NUMBERS.map(() => null);

const getButtonMappingIndex = (buttonNumber) => {
  const index = Number(buttonNumber) - 1;
  return index >= 0 && index < MAIN_BUTTON_NUMBERS.length ? index : -1;
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeButtonMapping = (mapping) =>
  mapping && typeof mapping === "object" && !Array.isArray(mapping)
    ? { ...mapping }
    : null;

const normalizeButtonMappings = (value) => {
  const mappings = createEmptyButtonMappings();

  if (Array.isArray(value)) {
    MAIN_BUTTON_NUMBERS.forEach((buttonNumber) => {
      const index = getButtonMappingIndex(buttonNumber);
      mappings[index] = normalizeButtonMapping(value[index]);
    });
    return mappings;
  }

  if (value && typeof value === "object") {
    MAIN_BUTTON_NUMBERS.forEach((buttonNumber) => {
      const index = getButtonMappingIndex(buttonNumber);
      mappings[index] = normalizeButtonMapping(value[buttonNumber]);
    });
  }

  return mappings;
};

const mergeButtonMappings = (target, source) => {
  let changed = false;

  MAIN_BUTTON_NUMBERS.forEach((buttonNumber) => {
    const index = getButtonMappingIndex(buttonNumber);
    const sourceMapping = normalizeButtonMapping(source[index]);

    if (!sourceMapping) return;

    const targetMapping = normalizeButtonMapping(target[index]) || {};
    Object.entries(sourceMapping).forEach(([property, value]) => {
      if (targetMapping[property] == null && value != null) {
        targetMapping[property] = value;
        changed = true;
      }
    });
    target[index] = targetMapping;
  });

  return changed;
};

const readButtonMappingsFromKey = (storage, key) => {
  const stored = storage.getItem(key);
  if (!stored) return createEmptyButtonMappings();

  return normalizeButtonMappings(safeJsonParse(stored));
};

const readCurrentButtonMappings = (storage, deviceId) =>
  readButtonMappingsFromKey(storage, getButtonMappingsStorageKey(deviceId));

const writeButtonMappings = (storage, deviceId, mappings) => {
  storage.setItem(
    getButtonMappingsStorageKey(deviceId),
    JSON.stringify(normalizeButtonMappings(mappings)),
  );
};

const setButtonMappingField = (
  mappings,
  buttonNumber,
  field,
  value,
  { overwrite = false } = {},
) => {
  const index = getButtonMappingIndex(buttonNumber);
  const property = MAIN_BUTTON_FIELD_TO_PROPERTY[field];

  if (index === -1 || !property || value === null) return false;

  const mapping = normalizeButtonMapping(mappings[index]) || {};
  if (!overwrite && mapping[property] != null) return false;

  mapping[property] = String(value);
  mappings[index] = mapping;
  return true;
};

const hasLegacyButtonMappings = (storage) =>
  MAIN_BUTTON_NUMBERS.some((buttonNumber) =>
    MAIN_BUTTON_FIELDS.some(
      (field) =>
        storage.getItem(
          getLegacyButtonMappingStorageKey(buttonNumber, field),
        ) !== null,
    ),
  );

const syncMigrationMarker = (storage, currentKey, oldKey) => {
  const currentValue = storage.getItem(currentKey);
  const oldValue = storage.getItem(oldKey);

  if (oldValue !== null && currentValue === null) {
    storage.setItem(currentKey, oldValue);
  }

  if (oldValue !== null) {
    storage.removeItem(oldKey);
  }

  return storage.getItem(currentKey);
};

const isMockingbirdPresetsPayload = (value) => {
  const parsed = safeJsonParse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }

  return Object.values(parsed).some(
    (preset) =>
      preset &&
      typeof preset === "object" &&
      typeof preset.context_uri === "string",
  );
};

const migrateOldMockingbirdScopedPresets = (storage, deviceId) => {
  const newKey = getDevicePresetStorageKey(MOCKINGBIRD_PRESETS_KEY, deviceId);

  getDevicePresetStorageKeys(OLD_MOCKINGBIRD_PRESETS_KEY, deviceId).forEach(
    (oldKey) => {
      if (oldKey === newKey) return;

      const oldValue = storage.getItem(oldKey);
      if (oldValue === null || !isMockingbirdPresetsPayload(oldValue)) return;

      if (storage.getItem(newKey) === null) {
        storage.setItem(newKey, oldValue);
      }

      storage.removeItem(oldKey);
    },
  );
};

const migrateOldMainButtonPresetLists = (storage, deviceId, mappings) => {
  let changed = false;

  getDevicePresetStorageKeys(OLD_MAIN_BUTTON_PRESET_KEY, deviceId).forEach(
    (oldKey) => {
      const oldValue = storage.getItem(oldKey);
      if (oldValue === null) return;

      changed =
        mergeButtonMappings(
          mappings,
          normalizeButtonMappings(safeJsonParse(oldValue)),
        ) || changed;
      storage.removeItem(oldKey);
    },
  );

  return changed;
};

const migrateScopedFieldButtonMappings = (storage, deviceId, mappings) => {
  let changed = false;

  MAIN_BUTTON_NUMBERS.forEach((buttonNumber) => {
    MAIN_BUTTON_FIELDS.forEach((field) => {
      const scopedKeys = [MAIN_BUTTON_PRESET_KEY, OLD_MAIN_BUTTON_PRESET_KEY]
        .flatMap((baseKey) => [
          getScopedFieldButtonMappingStorageKey(
            baseKey,
            buttonNumber,
            field,
            deviceId,
          ),
          getEncodedScopedFieldButtonMappingStorageKey(
            baseKey,
            buttonNumber,
            field,
            deviceId,
          ),
        ])
        .filter((key, index, keys) => keys.indexOf(key) === index);

      scopedKeys.forEach((scopedKey) => {
        const value = storage.getItem(scopedKey);

        if (value !== null) {
          changed =
            setButtonMappingField(mappings, buttonNumber, field, value) ||
            changed;
          storage.removeItem(scopedKey);
        }
      });
    });
  });

  return changed;
};

const migrateButtonMappings = (storage, deviceId) => {
  const normalizedDeviceId = normalizePresetDeviceId(deviceId);

  migrateOldMockingbirdScopedPresets(storage, normalizedDeviceId);
  migrateEncodedDeviceStorageKey(storage, MAIN_BUTTON_PRESET_KEY, deviceId);

  const mappings = readCurrentButtonMappings(storage, normalizedDeviceId);
  let changed = migrateOldMainButtonPresetLists(
    storage,
    normalizedDeviceId,
    mappings,
  );
  changed =
    migrateScopedFieldButtonMappings(storage, normalizedDeviceId, mappings) ||
    changed;

  const migratedDeviceId = syncMigrationMarker(
    storage,
    MAIN_BUTTON_LEGACY_MIGRATION_KEY,
    OLD_MAIN_BUTTON_LEGACY_MIGRATION_KEY,
  );

  if (
    normalizedDeviceId === NO_DEVICE_PRESET_SCOPE ||
    migratedDeviceId ||
    !hasLegacyButtonMappings(storage)
  ) {
    if (changed) {
      writeButtonMappings(storage, normalizedDeviceId, mappings);
    }
    return mappings;
  }

  MAIN_BUTTON_NUMBERS.forEach((buttonNumber) => {
    MAIN_BUTTON_FIELDS.forEach((field) => {
      const legacyKey = getLegacyButtonMappingStorageKey(buttonNumber, field);
      const value = storage.getItem(legacyKey);

      if (value !== null) {
        changed =
          setButtonMappingField(mappings, buttonNumber, field, value) ||
          changed;
      }
    });
  });

  storage.setItem(MAIN_BUTTON_LEGACY_MIGRATION_KEY, normalizedDeviceId);
  writeButtonMappings(storage, normalizedDeviceId, mappings);

  return mappings;
};

export const getButtonMappingValue = (
  buttonNumber,
  field,
  deviceId = getActivePresetDeviceId(),
) => {
  const storage = getStorage();
  if (!storage) return null;

  const normalizedDeviceId = normalizePresetDeviceId(deviceId);
  const mappings = migrateButtonMappings(storage, normalizedDeviceId);
  const index = getButtonMappingIndex(buttonNumber);
  const property = MAIN_BUTTON_FIELD_TO_PROPERTY[field];
  const scopedValue =
    index === -1 || !property ? null : mappings[index]?.[property] || null;

  if (
    scopedValue === null &&
    normalizedDeviceId === NO_DEVICE_PRESET_SCOPE &&
    !storage.getItem(MAIN_BUTTON_LEGACY_MIGRATION_KEY)
  ) {
    return storage.getItem(
      getLegacyButtonMappingStorageKey(buttonNumber, field),
    );
  }

  return scopedValue;
};

export const setButtonMappingValue = (
  buttonNumber,
  field,
  value,
  deviceId = getActivePresetDeviceId(),
) => {
  const storage = getStorage();
  if (!storage) return;

  const normalizedDeviceId = normalizePresetDeviceId(deviceId);
  const mappings = migrateButtonMappings(storage, normalizedDeviceId);
  const changed = setButtonMappingField(
    mappings,
    buttonNumber,
    field,
    value == null ? "" : value,
    { overwrite: true },
  );

  if (changed) {
    writeButtonMappings(storage, normalizedDeviceId, mappings);
  }
};

export const getMockingbirdPresetsStorageKey = (
  deviceId = getActivePresetDeviceId(),
) => getDevicePresetStorageKey(MOCKINGBIRD_PRESETS_KEY, deviceId);

export const migrateLegacyMockingbirdPresets = (deviceId) => {
  const storage = getStorage();
  if (!storage) return;

  const normalizedDeviceId = normalizePresetDeviceId(deviceId);
  migrateEncodedDeviceStorageKey(
    storage,
    MOCKINGBIRD_PRESETS_KEY,
    normalizedDeviceId,
  );
  migrateOldMockingbirdScopedPresets(storage, normalizedDeviceId);

  const migratedDeviceId = syncMigrationMarker(
    storage,
    MOCKINGBIRD_LEGACY_MIGRATION_KEY,
    OLD_MOCKINGBIRD_LEGACY_MIGRATION_KEY,
  );

  if (normalizedDeviceId === NO_DEVICE_PRESET_SCOPE || migratedDeviceId) {
    return;
  }

  const legacyPresets = storage.getItem(OLD_MOCKINGBIRD_PRESETS_KEY);
  if (!legacyPresets) return;

  const scopedKey = getMockingbirdPresetsStorageKey(normalizedDeviceId);
  if (storage.getItem(scopedKey) === null) {
    storage.setItem(scopedKey, legacyPresets);
  }

  storage.setItem(MOCKINGBIRD_LEGACY_MIGRATION_KEY, normalizedDeviceId);
};
