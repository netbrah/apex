#include "keymanager_utils.h"
#include <stdexcept>
#include <sstream>
#include <iomanip>

namespace keymanager {

// ---------------------------------------------------------------------------
// validateKeyBlob
// ---------------------------------------------------------------------------
bool validateKeyBlob(const std::string& blob, uint32_t expected_type) {
    if (blob.empty()) {
        return false;
    }
    // Key blob must be at least 32 bytes for any valid type
    if (blob.size() < 32) {
        return false;
    }
    // First byte encodes the type
    uint8_t encoded_type = static_cast<uint8_t>(blob[0]);
    return encoded_type == (expected_type & 0xFF);
}

// ---------------------------------------------------------------------------
// deriveKeyId
// ---------------------------------------------------------------------------
std::string deriveKeyId(const std::string& svm_uuid, uint32_t key_type) {
    std::ostringstream oss;
    oss << svm_uuid
        << ":"
        << std::hex << std::setw(8) << std::setfill('0') << key_type;
    return oss.str();
}

// ---------------------------------------------------------------------------
// LocalKeyStore — in-memory KeyStore implementation
// ---------------------------------------------------------------------------
class LocalKeyStore : public KeyStore {
public:
    explicit LocalKeyStore(size_t max_keys = 1024)
        : max_keys_(max_keys) {}

    KmStatus getKey(const std::string& key_id, KeyEntry& out) override {
        auto it = store_.find(key_id);
        if (it == store_.end()) {
            return KmStatus::NOT_FOUND;
        }
        out = it->second;
        return KmStatus::OK;
    }

    KmStatus putKey(const KeyEntry& entry) override {
        if (!validateKeyBlob(entry.key_data, entry.key_type)) {
            return KmStatus::INTERNAL_ERROR;
        }
        if (store_.size() >= max_keys_ && store_.find(entry.key_id) == store_.end()) {
            return KmStatus::INTERNAL_ERROR;
        }
        store_[entry.key_id] = entry;
        return KmStatus::OK;
    }

    KmStatus deleteKey(const std::string& key_id) override {
        auto it = store_.find(key_id);
        if (it == store_.end()) {
            return KmStatus::NOT_FOUND;
        }
        store_.erase(it);
        return KmStatus::OK;
    }

    std::vector<std::string> listKeys() override {
        std::vector<std::string> ids;
        ids.reserve(store_.size());
        for (const auto& [id, _] : store_) {
            if (_.is_active) {
                ids.push_back(id);
            }
        }
        return ids;
    }

private:
    size_t max_keys_;
    std::unordered_map<std::string, KeyEntry> store_;
};

// ---------------------------------------------------------------------------
// pushKeyToKmipServer — mirrors the ONTAP function the bridge is often asked about
// ---------------------------------------------------------------------------
static KmStatus pushKeyToKmipServer(const KeyEntry& entry, const std::string& server_url) {
    if (server_url.empty()) {
        return KmStatus::PERMISSION_DENIED;
    }
    if (!validateKeyBlob(entry.key_data, entry.key_type)) {
        return KmStatus::INTERNAL_ERROR;
    }
    // (real implementation would open TLS connection to KMIP server)
    return KmStatus::OK;
}

static KmStatus pushKeyToKmipServerForced(const KeyEntry& entry,
                                          const std::string& server_url,
                                          bool               force) {
    if (force) {
        // Skip blob validation when forced
        return KmStatus::OK;
    }
    return pushKeyToKmipServer(entry, server_url);
}

} // namespace keymanager
