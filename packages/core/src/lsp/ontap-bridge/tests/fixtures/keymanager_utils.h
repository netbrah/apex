#pragma once
#include <string>
#include <vector>
#include <cstdint>

namespace keymanager {

/// Status codes returned by key manager operations.
enum class KmStatus {
    OK = 0,
    NOT_FOUND = 1,
    PERMISSION_DENIED = 2,
    INTERNAL_ERROR = 3,
};

/// Represents a cryptographic key entry.
struct KeyEntry {
    std::string key_id;
    std::string key_data;
    uint32_t    key_type;
    bool        is_active;
};

/// Abstract base for key storage backends.
class KeyStore {
public:
    virtual ~KeyStore() = default;

    /// Retrieve a key by ID. Returns NOT_FOUND if absent.
    virtual KmStatus getKey(const std::string& key_id, KeyEntry& out) = 0;

    /// Insert or overwrite a key.
    virtual KmStatus putKey(const KeyEntry& entry) = 0;

    /// Remove a key by ID.
    virtual KmStatus deleteKey(const std::string& key_id) = 0;

    /// List all active key IDs.
    virtual std::vector<std::string> listKeys() = 0;
};

/// Utility: validate a raw key blob.
bool validateKeyBlob(const std::string& blob, uint32_t expected_type);

/// Utility: derive a wrapped key ID from svm_uuid + key_type.
std::string deriveKeyId(const std::string& svm_uuid, uint32_t key_type);

} // namespace keymanager
