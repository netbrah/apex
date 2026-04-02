# SMF Test Patterns — Comprehensive Mocking Guide

Reference for writing ONTAP unit tests. Read this when writing or modifying `.ut` files.

## Mocking Hierarchy (Least → Most Invasive)

### Level 1: SmfMethodReturnHelper — Return Status Only

Forces a specific return status for a named SMF table method without changing internal logic.

```cpp
CxxTestSmfHelpers::SmfMethodReturnHelper helper(
    smdb_table__volume_encryption_modify_enc_blob_start,
    smdb_error::Ok
);
```

RAII-scoped. Cannot control output fields or side effects.

### Level 2: SmfTableErrorHelper — Next Operation Error

Injects a `smdb_error` into the next occurrence of a named operation.

```cpp
CxxTestSmfHelpers::SmfTableErrorHelper removeFailure(
    smdb_table__ekmip_partition_mdb,
    smdb_iterator::opRemove,
    smdb_error::ResourceLimit
);
```

Operations: `opCreate`, `opGet`, `opModify`, `opRemove`, `opNext`. One-shot — consumes on first match.

### Level 3: SmfTableReplaceImpHelper — Full \*\_imp() Replacement

Replaces an SMF iterator operation's implementation with a test handler. Controls output fields + return.

```cpp
class cryptomod_rewrap_key_Helper : public test::AbstractCmdCryptoErrorHelper {
    CxxTestHelpers::SmfTableReplaceImpHelper _createReplacement;

    smdb_error fake_create_imp(cryptomod_rewrap_key_iterator* itr) {
        smdb_error err = getNextResult();
        if (err.is_ok()) {
            itr->set_unwrapped_key(getNextUnwrappedKey());
        }
        return err;
    }

    static smdb_error fake_create(smdb_iterator* pItr);

    cryptomod_rewrap_key_Helper()
      : _createReplacement(smdb_table__cryptomod_rewrap_key,
                           smdb_iterator::opCreate, fake_create)
    { inScopeHelper = this; }
};
```

Requires helper class infrastructure. Stateful — can maintain state across calls.

### Level 4: Mocker<T> — Free Function Override

Overrides free functions or static methods for the test's lifetime.

```cpp
typedef smdb_error (*getUnwrappedKeyFunc)(const HexString& keyId, smdb_list& keyList);

class CryptoUtil_getUnwrappedKey_Mocker {
    Mocker<getUnwrappedKeyFunc> _mock;
public:
    static smdb_error mockGetUnwrappedKey_EmptyKey(const HexString& keyId,
                                                    smdb_list& keyList) {
        smdb_type_HexString_instance.push_back(keyList, HexString());
        return smdb_error::Ok;
    }
    CryptoUtil_getUnwrappedKey_Mocker()
      : _mock(CryptoUtil::getUnwrappedKey, mockGetUnwrappedKey_EmptyKey) {}
};
```

### Level 4b: Mocker + typeof() — Member Function Override

For non-static member functions, use `typeof()` to get the pointer type.

```cpp
class volume_iterator_addQuery_vserver__Mocker {
public:
    bool addQuery_vserver_fail(const std::string& text, bool replaceExist = false) {
        return false;
    }
};

Mocker<typeof(&volume_iterator::addQuery_vserver)> addQueryMocker(
    &volume_iterator::addQuery_vserver,
    (typeof(&volume_iterator::addQuery_vserver))
        &volume_iterator_addQuery_vserver__Mocker::addQuery_vserver_fail);
```

### Level 5: Object Test Doubles — Stateful Interface Mocks

Full mock objects implementing interfaces. Example: `CryptomodTestHelper`.

```cpp
auto helper = std::make_shared<CryptomodTestHelper>();
helper->setUnwrapError(smdb_error::DuplicateKey);
// All calls through CryptomodInterface now use the fake
```

Per-method error injection: `setNextError()`, `setUnwrapError()`, `setImportError()`, `setDeleteError()`.

### Level 6: SmfTableMockHelper — Complete Table Mock

Complete mock for all methods on a table.

```cpp
class kmip_keytable_v2_mock
  : public CxxTestHelpers::SmfTableMockHelper<
        kmip_keytable_v2_iterator,
        kmip_keytable_v2_getUncachedUuids_iterator,
        kmip_keytable_v2_cacheUuid_iterator> {
protected:
    smdb_error method_imp(kmip_keytable_v2_getUncachedUuids_iterator& itr) override {
        smdb_list uuidList(&smdb_type_text_instance);
        smdb_type_text_instance.push_back(uuidList, SYM_KEY_UUID_1.to_string());
        itr.set_uuids(uuidList);
        return smdb_error::Ok;
    }
};
```

### Level 7: NoImpsTableSetup — Schema Only

Registers table schemas without implementations.

```cpp
registerFixture(std::make_shared<CxxTestHelpers::NoImpsTableSetup>(
    smdb_table__cryptomodKeyTable));
```

Table setup types: `NoImpsTableSetup` (schema only), `ImpsTableSetup` (real implementations), `RdbTableSetup` (cluster/RDB semantics), `JsonTableMock` (data from JSON).

### Level 8: ScopedFaultAlways / FaultDecoratorReturn

FIJI fault injection to force code branches.

```cpp
ScopedFaultAlways fh_bypass("keymanager.bypassquorumcheck");

FaultDecoratorReturn fault(
    new ScopedFaultAlways("tables.keymanager.keymanager_okm_on_usb.exit_status"),
    keymanager_okm_on_usb_iterator::EXECUTION_SUCCESSFUL
);
```

## Advanced: Fail on Nth Call

Counter + Mocker pattern for "succeed N times then fail":

```cpp
class rdb_tran_mck_class {
public:
    static int timesBeforeTxnCommitFailure;
    smdb_error commit_fail() {
        if (timesBeforeTxnCommitFailure > 0) {
            --timesBeforeTxnCommitFailure;
            return smdb_error::Ok;
        }
        return smdb_error(RDB_UNIT_OFFLINE);
    }
};
```

## Decision Matrix

| Need                              | Pattern                  | Complexity  |
| --------------------------------- | ------------------------ | ----------- |
| Control method return status only | SmfMethodReturnHelper    | Low         |
| Fail next specific operation      | SmfTableErrorHelper      | Low         |
| Control output fields + status    | SmfTableReplaceImpHelper | Medium      |
| Mock free function                | Mocker                   | Medium      |
| Mock member function              | Mocker + typeof()        | Medium-High |
| Stateful interface mock           | Object test double       | High        |
| Mock entire table behavior        | SmfTableMockHelper       | High        |
| Register schema only              | NoImpsTableSetup         | Low         |
| Force fault/branch                | ScopedFaultAlways        | Low         |
| Sequence multiple returns         | Counter + Mocker         | Medium      |

## Common Helper Classes

Located in `src/test_helpers/`:

- `VserverHelper` — vserver table entries
- `KeymanagerKeystoreHelper` — keystore state
- `KeymanagerExternalHelper` — external key manager config
- `ClusterKdbHelper` — cluster key database
- `KmipKeyserversV2RdbHelper` — KMIP key server config
- `KeymanagerConfigRdbHelper` — key manager configuration
- `FilerHelper` — node/filer information

Cryptomod helpers in `src/test_helpers/kern/`:

- `cryptomod_rewrap_key_Helper`, `cryptomod_create_pdek_Helper`, `cryptomod_create_svm_kek_Helper`, `cryptomod_get_svm_kek_Helper`, `cryptomod_create_mroot_ak_Helper`

## Anti-Patterns

- **No global variable mocks** — use instance-based mocks instead
- **No duplicate mock classes for same iterator** — use single configurable helper
- **No testing only return codes** — assert meaningful state
- **`prepare_unit_test_context`** — use as a final cross-check only, not as a starting point. Build test context yourself from `analyze_symbol_ast` + reading the test file.

## Common Combination Pattern

```cpp
void test_complex_scenario() {
    // 1. Schema isolation (NoImpsTableSetup in constructor)
    // 2. Targeted operation mock
    cryptomod_rewrap_key_Helper rewrapHelper;
    rewrapHelper.setNextUnwrappedKey(KEY);
    // 3. Error injection
    CxxTestSmfHelpers::SmfTableErrorHelper errorHelper(
        smdb_table__svm_kdb_rdb, smdb_iterator::opModify, smdb_error::ResourceLimit);
    // 4. Utility function mock
    CryptoUtil_getUnwrappedKey_Mocker utilMocker;
    // 5. Fault injection
    ScopedFaultAlways fh_bypass("keymanager.bypassquorumcheck");
}
```
